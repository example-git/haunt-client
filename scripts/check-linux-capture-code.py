import argparse
import json
import os
from pathlib import Path
import select
import shlex
import signal
import socket
import struct
import subprocess
import tempfile
import time


ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "test-results/capture-code"
BINARIES = ROOT / "release/native/tests"


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def run(*args, **kwargs):
    return subprocess.check_output(args, **kwargs)


def build():
    BINARIES.mkdir(parents=True, exist_ok=True)
    for source, packages in [
        ("capture-pipewire", ["gstreamer-1.0", "gstreamer-app-1.0", "gstreamer-video-1.0", "gio-unix-2.0", "libpulse", "x11", "xrandr", "xcomposite"]),
        ("pipewire-video-source", ["libpipewire-0.3"]),
    ]:
        flags = shlex.split(run("pkg-config", "--cflags", "--libs", *packages).decode())
        subprocess.check_call(["cc", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror",
            str(ROOT / f"native/tests/{source}.c"), "-o", str(BINARIES / source), *flags])


class Capture:
    def __init__(self, arguments, env, log):
        reader, writer = socket.socketpair()
        self.reader = reader
        self.bytes = bytearray()
        self.segments = []
        self.timestamps = []

        def output_fd():
            os.dup2(writer.fileno(), 3)

        self.process = subprocess.Popen([str(BINARIES / "capture-pipewire"), *map(str, arguments)],
            stdin=subprocess.PIPE, stdout=log, stderr=log, env=env,
            pass_fds=(3, writer.fileno()), preexec_fn=output_fd)
        writer.close()

    def receive(self, timeout=0.1):
        if not select.select([self.reader], [], [], timeout)[0]:
            return
        data = self.reader.recv(1024 * 1024)
        check(data, f"Capture output closed; exit={self.process.poll()}")
        self.bytes.extend(data)
        while len(self.bytes) >= 24:
            header = self.bytes[:24]
            check(header[:5] == b"SCAP\x01", "Invalid production packet header")
            length = struct.unpack_from(">I", header, 16)[0]
            check(0 < length <= 4 * 1024 * 1024, "Invalid capture packet size")
            if len(self.bytes) < 24 + length:
                break
            payload = bytes(self.bytes[24:24 + length])
            del self.bytes[:24 + length]
            if header[5] == 1:
                config = json.loads(payload)
                check(config["codec"] == "h264" and config["format"] == "annexb", config)
                check(config["encoder"] == "x264enc", config)
                check(config["parameterSets"], "Missing H.264 parameter sets")
                self.segments.append({"config": config, "frames": [], "keys": []})
            elif header[5] == 2:
                check(self.segments, "Video arrived before decoder configuration")
                timestamp = struct.unpack_from(">Q", header, 8)[0]
                check(not self.timestamps or timestamp > self.timestamps[-1], "Video timestamps did not advance")
                self.timestamps.append(timestamp)
                self.segments[-1]["frames"].append(payload)
                self.segments[-1]["keys"].append(header[7])
            else:
                raise AssertionError(f"Unexpected packet type {header[5]}")

    def until(self, predicate, timeout=12):
        deadline = time.monotonic() + timeout
        while not predicate():
            check(time.monotonic() < deadline, "Timed out waiting for encoded video")
            self.receive()

    def command(self, command):
        self.process.stdin.write((command + "\n").encode())
        self.process.stdin.flush()

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
        self.process.wait(timeout=5)
        self.reader.close()
        self.process.stdin.close()


def decode(segment, filename, expected):
    config = segment["config"]
    width, height, rate = expected
    check((config["width"], config["height"], config["fps"]) == expected, config)
    check(segment["keys"][0] == 1, "Segment did not start with a keyframe")
    filename.write_bytes(b"".join(segment["frames"]))
    pixels = run("ffmpeg", "-v", "error", "-xerror", "-i", str(filename),
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-threads", "1", "pipe:1")
    frame_size = width * height * 3
    check(len(pixels) == len(segment["frames"]) * frame_size,
        f"Not every encoded frame decoded: {len(pixels)} bytes, {len(segment['frames'])} packets")
    for frame in range(len(segment["frames"])):
        for x, expected_rgb in [(width // 4, (224, 32, 64)), (3 * width // 4, (32, 224, 64))]:
            offset = frame * frame_size + (height // 2 * width + x) * 3
            actual = tuple(pixels[offset:offset + 3])
            check(all(abs(a - b) < 24 for a, b in zip(actual, expected_rgb)),
                f"Decoded pixel mismatch at frame {frame}: {actual}, expected {expected_rgb}")
    return {"width": width, "height": height, "fps": rate, "decodedFrames": len(segment["frames"])}


def execute(minimum_version):
    RESULTS.mkdir(parents=True, exist_ok=True)
    version = run("pipewire", "--version").decode().strip()
    print(version, flush=True)
    if minimum_version:
        import re
        versions = re.findall(r"\b(\d+)\.(\d+)\.(\d+)\b", version)
        check(versions and min(tuple(map(int, v)) for v in versions) >= tuple(map(int, minimum_version.split("."))),
            "PipeWire server is too old for the required buffer negotiation check")
    cases = [
        {"name": "two-buffers-padded", "size": (641, 361), "buffers": (2, 2), "format": "BGRx", "padding": 60, "expected": (640, 360, 60)},
        {"name": "portrait-rgb", "size": (360, 640), "buffers": (2, 4), "format": "RGBx", "padding": 0, "expected": (270, 480, 30)},
        {"name": "wide-padded", "size": (1280, 360), "buffers": (2, 16), "format": "BGRx", "padding": 64, "expected": (640, 180, 15)},
        {"name": "source-stops", "size": (320, 240), "buffers": (2, 4), "format": "BGRx", "padding": 0, "failure": "source"},
        {"name": "invalid-reconfigure", "size": (320, 240), "buffers": (2, 4), "format": "BGRx", "padding": 0, "failure": "configure"},
        {"name": "closed-output", "size": (320, 240), "buffers": (2, 4), "format": "BGRx", "padding": 0, "failure": "output"},
        {"name": "no-source-frames", "size": (320, 240), "buffers": (2, 4), "format": "BGRx", "padding": 0, "failure": "timeout"},
    ]
    with tempfile.TemporaryDirectory(prefix="haunt-capture-code-") as scratch:
        env = {**os.environ, "XDG_RUNTIME_DIR": scratch, "XDG_CACHE_HOME": scratch + "/cache"}
        for key in ["DISPLAY", "WAYLAND_DISPLAY", "PULSE_SERVER", "PIPEWIRE_REMOTE", "PIPEWIRE_CONFIG_DIR", "PIPEWIRE_CONFIG_PREFIX", "PIPEWIRE_CONFIG_NAME", "PIPEWIRE_MODULE_DIR", "SPA_PLUGIN_DIR", "LD_LIBRARY_PATH", "LD_PRELOAD"]:
            env.pop(key, None)
        config = Path(scratch) / "daemon.conf"
        config.write_text('''context.properties = { core.daemon = true core.name = pipewire-0 }
context.spa-libs = { support.* = support/libspa-support }
context.modules = [
 { name = libpipewire-module-protocol-native }
 { name = libpipewire-module-client-node }
 { name = libpipewire-module-link-factory }
 { name = libpipewire-module-access args = { access.force = unrestricted } }
]
''')
        with (RESULTS / "pipewire.log").open("w") as daemon_log:
            daemon = subprocess.Popen(["pipewire", "-c", str(config)], env=env, stdout=daemon_log, stderr=daemon_log)
            try:
                deadline = time.monotonic() + 10
                while not (Path(scratch) / "pipewire-0").exists():
                    check(daemon.poll() is None and time.monotonic() < deadline, "Private PipeWire server failed")
                    time.sleep(0.05)
                binary = ROOT / "release/native/linux/HauntCaptureWorker"
                runtime = Path(json.loads(run(str(binary), "--runtime-info", env=env))["root"])
                capture_env = {**env, "LD_LIBRARY_PATH": str(runtime / "lib"),
                    "GST_PLUGIN_SYSTEM_PATH": str(runtime / "plugins"), "GST_PLUGIN_SYSTEM_PATH_1_0": str(runtime / "plugins"),
                    "GST_PLUGIN_PATH": "", "GST_PLUGIN_PATH_1_0": "", "GST_REGISTRY_FORK": "no",
                    "GST_PLUGIN_SCANNER": str(runtime / "bin/gst-plugin-scanner"),
                    "GST_PLUGIN_SCANNER_1_0": str(runtime / "bin/gst-plugin-scanner"),
                    "GST_REGISTRY": str(runtime / "registry.bin"), "GST_REGISTRY_1_0": str(runtime / "registry.bin"),
                    "PIPEWIRE_MODULE_DIR": str(runtime / "pipewire"), "PIPEWIRE_CONFIG_DIR": str(runtime / "pipewire-config"),
                    "PIPEWIRE_CONFIG_PREFIX": "", "PIPEWIRE_CONFIG_NAME": "client.conf", "SPA_PLUGIN_DIR": str(runtime / "spa"),
                    "GST_CUDA_NVRTC_LIBNAME": str(runtime / "lib/libnvrtc.so"), "GST_DEBUG": "2,pipewiresrc:5", "GST_DEBUG_NO_COLOR": "1"}
                reports = []
                for case in cases:
                    print("Testing", case["name"], flush=True)
                    source = capture = None
                    with (RESULTS / (case["name"] + "-source.log")).open("w") as source_log, (RESULTS / (case["name"] + ".log")).open("w") as capture_log:
                        try:
                            source = subprocess.Popen([str(BINARIES / "pipewire-video-source"),
                                *map(str, case["size"]), *map(str, case["buffers"]), case["format"], str(case["padding"]),
                                "silent" if case.get("failure") == "timeout" else "frames"],
                                env=env, stdout=subprocess.PIPE, stderr=source_log, text=True)
                            check(select.select([source.stdout], [], [], 10)[0], "Video source did not publish a node")
                            node = int(source.stdout.readline())
                            rate = case.get("expected", (0, 0, 30))[2]
                            capture = Capture([node, 640, 480, rate, *case["size"]], capture_env, capture_log)
                            if case.get("failure") == "timeout":
                                check(capture.process.wait(timeout=22) == 1, "Frame timeout did not fail")
                                expected_error = "PipeWire screen capture produced no video frame within 15 seconds"
                            else:
                                capture.until(lambda: capture.segments and len(capture.segments[0]["frames"]) >= 12)
                                if case.get("failure") == "source":
                                    source.terminate(); source.wait(timeout=5)
                                    check(capture.process.wait(timeout=10) == 1, "Lost source did not fail")
                                    expected_error = "Capture failure:"
                                elif case.get("failure") == "configure":
                                    capture.command("configure 640 480 17")
                                    check(capture.process.wait(timeout=5) == 1, "Invalid mode did not fail")
                                    expected_error = "Invalid capture mode"
                                elif case.get("failure") == "output":
                                    capture.reader.shutdown(socket.SHUT_RD)
                                    check(capture.process.wait(timeout=5) == 1, "Closed output did not fail")
                                    expected_error = "Capture pipe closed"
                                else:
                                    capture.command("configure 320 240 15")
                                    capture.until(lambda: len(capture.segments) == 2 and len(capture.segments[1]["frames"]) >= 12)
                                    capture.command("stop")
                                    check(capture.process.wait(timeout=5) == 0, "Normal stop failed")
                                    source.terminate()
                                    check(source.wait(timeout=5) == 0, "Source exceeded its negotiated buffer limit")
                                    expected_error = None
                                    second = {"two-buffers-padded": (320, 180, 15), "portrait-rgb": (134, 240, 15), "wide-padded": (320, 90, 15)}[case["name"]]
                                    reports.append({"case": case["name"], "segments": [decode(segment,
                                        RESULTS / f"{case['name']}-{index}.h264", expected)
                                        for index, (segment, expected) in enumerate(zip(capture.segments, [case["expected"], second]))]})
                            if expected_error:
                                check(expected_error in (RESULTS / (case["name"] + ".log")).read_text(), "Missing failure diagnostic")
                                reports.append({"case": case["name"], "diagnostic": expected_error})
                        finally:
                            if capture:
                                capture.close()
                            if source:
                                if source.poll() is None:
                                    source.terminate()
                                source.wait(timeout=5)
                                source.stdout.close()
                (RESULTS / "report.json").write_text(json.dumps({"pipewire": version, "runtime": str(runtime), "cases": reports}, indent=2) + "\n")
            finally:
                daemon.terminate()
                daemon.wait(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--minimum-pipewire")
    args = parser.parse_args()
    check(os.environ.get("CI") == "true", "Native capture tests require an isolated CI environment")
    if args.build:
        build()
    execute(args.minimum_pipewire)

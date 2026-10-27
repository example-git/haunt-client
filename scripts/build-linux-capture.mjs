import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export async function buildLinuxCapture() {
  if (process.platform !== "linux") return;
  if ((process.env.HAUNT_DESKTOP_ARCH || process.arch) !== process.arch)
    throw Error("Build Linux capture on the target architecture.");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const target = path.join(root, "release/native/linux");
  const run = (command, args, options = {}) =>
    (
      execFileSync(command, args, { encoding: "utf8", ...options }) ?? ""
    ).trim();
  await fs.mkdir(target, { recursive: true });
  for (const name of ["lib", "plugins", "pipewire", "spa", "pipewire-config"])
    await fs.rm(path.join(target, name), { recursive: true, force: true });
  const worker = path.join(target, "HauntCaptureWorker");
  run(
    process.env.CC || "cc",
    [
      "-std=gnu11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      path.join(root, "native/linux-capture.c"),
      "-o",
      worker,
      "-Wl,-rpath,$ORIGIN/lib",
      ...run("pkg-config", [
        "--cflags",
        "--libs",
        "gstreamer-1.0",
        "gstreamer-app-1.0",
        "gstreamer-video-1.0",
        "gio-unix-2.0",
        "libpulse",
        "x11",
        "xrandr",
        "xcomposite",
      ]).split(/\s+/),
    ],
    { stdio: "inherit" },
  );
  run(
    "go",
    [
      "build",
      "-trimpath",
      "-ldflags=-s -w",
      "-o",
      path.join(target, "HauntMediaWorker"),
      ".",
    ],
    {
      cwd: path.join(root, "native/media-worker"),
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: "linux",
        GOARCH: process.arch === "arm64" ? "arm64" : "amd64",
      },
      stdio: "inherit",
    },
  );
  for (const name of ["lib", "plugins", "pipewire", "spa", "pipewire-config"])
    await fs.mkdir(path.join(target, name), { recursive: true });
  const copied = new Set();
  const packages = new Set();
  const sources = new Set();
  const copy = async (source, destination) => {
    if (copied.has(destination)) return;
    copied.add(destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    sources.add(await fs.realpath(source));
    for (const line of run("ldd", [source]).split("\n")) {
      if (line.includes("not found"))
        throw Error(`Missing capture runtime dependency: ${line.trim()}`);
      const found = line.match(/=>\s+(\/\S+)/);
      if (!found) continue;
      const name = path.basename(found[1]);
      if (
        /^(?:libc|libm|libpthread|libdl|librt|libresolv|libutil|libanl)\.so\./.test(
          name,
        )
      )
        continue;
      await copy(found[1], path.join(target, "lib", name));
    }
  };
  for (const line of run("ldd", [worker]).split("\n")) {
    const found = line.match(/=>\s+(\/\S+)/);
    if (
      found &&
      !/^(?:libc|libm|libpthread|libdl|librt|libresolv|libutil|libanl)\.so\./.test(
        path.basename(found[1]),
      )
    )
      await copy(found[1], path.join(target, "lib", path.basename(found[1])));
  }
  for (const plugin of [
    "app",
    "coreelements",
    "videoconvertscale",
    "videorate",
    "videoparsersbad",
    "ximagesrc",
    "x264",
    "nvcodec",
    "audiomixer",
    "audiotestsrc",
    "pipewire",
  ]) {
    const filename = run("gst-inspect-1.0", [plugin]).match(
      /^\s*Filename\s+(\S+)$/m,
    )?.[1];
    if (!filename) throw Error(`Missing GStreamer plugin: ${plugin}`);
    await copy(filename, path.join(target, "plugins", path.basename(filename)));
  }
  const libdir = run("pkg-config", ["--variable=libdir", "gstreamer-1.0"]);
  for (const name of ["client-node", "protocol-native", "metadata"])
    await copy(
      path.join(libdir, "pipewire-0.3", `libpipewire-module-${name}.so`),
      path.join(target, "pipewire", `libpipewire-module-${name}.so`),
    );
  for (const name of ["libspa-support.so"])
    await copy(
      path.join(libdir, "spa-0.2/support", name),
      path.join(target, "spa/support", name),
    );
  await fs.writeFile(
    path.join(target, "pipewire-config/client.conf"),
    `context.properties = { log.level = 0 }\ncontext.spa-libs = { support.* = support/libspa-support }\ncontext.modules = [ { name = libpipewire-module-protocol-native } { name = libpipewire-module-client-node } { name = libpipewire-module-metadata } ]\n`,
  );
  let notices =
    "Haunt Linux capture runtime\n\nGStreamer, PipeWire and PulseAudio runtime libraries and plugins.\n\n";
  const owners = run("dpkg-query", ["-S", ...sources], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const line of owners.split("\n")) packages.add(line.split(": ")[0]);
  for (const pkg of [...packages].sort()) {
    const name = pkg.replace(/:(?:amd64|arm64)$/, "");
    const copyright = await fs.readFile(
      `/usr/share/doc/${name}/copyright`,
      "utf8",
    );
    notices += `${pkg}\n${copyright}\n\n`;
  }
  const modules = new Set(
    run(
      "go",
      ["list", "-deps", "-f", "{{if .Module}}{{.Module.Dir}}{{end}}", "."],
      { cwd: path.join(root, "native/media-worker") },
    )
      .split("\n")
      .filter(Boolean),
  );
  modules.add(run("go", ["env", "GOROOT"]));
  for (const directory of modules)
    for (const name of ["LICENSE", "LICENSE.md", "LICENSE.txt"])
      try {
        notices += `${path.basename(directory)}\n${await fs.readFile(path.join(directory, name), "utf8")}\n\n`;
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
  await fs.writeFile(path.join(target, "NOTICE.txt"), notices);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildLinuxCapture();

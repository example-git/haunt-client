import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export async function buildLinuxCapture() {
  if (process.platform !== "linux") return;
  if ((process.env.HAUNT_DESKTOP_ARCH || process.arch) !== process.arch)
    throw Error("Build Linux capture on the target architecture.");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const destination = path.join(root, "release/native/linux");
  await fs.mkdir(destination, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(root, "release/capture-build-"));
  const target = path.join(workspace, "runtime");
  try {
    const run = (command, args, options = {}) =>
      (
        execFileSync(command, args, { encoding: "utf8", ...options }) ?? ""
      ).trim();
    await fs.mkdir(target, { recursive: true });
    const vendor = path.join(root, "vendor/selkies-gstreamer");
    let vendorLib, vendorRoot, vendorManifest;
    const buildEnv = { ...process.env };
    if (process.arch === "x64") {
      vendorManifest = JSON.parse(
        await fs.readFile(path.join(vendor, "manifest.json")),
      );
      const archive = path.join(vendor, vendorManifest.archive.file);
      const bytes = await fs.readFile(archive);
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        vendorManifest.archive.sha256
      )
        throw Error("Selkies GStreamer archive checksum mismatch");
      vendorRoot = path.join(workspace, "selkies");
      await fs.mkdir(vendorRoot);
      run("tar", ["-xJf", archive, "-C", vendorRoot]);
      vendorLib = path.join(vendorRoot, "lib/x86_64-linux-gnu");
      const pc = path.join(vendorLib, "pkgconfig");
      for (const name of await fs.readdir(pc)) {
        const filename = path.join(pc, name);
        await fs.writeFile(
          filename,
          (await fs.readFile(filename, "utf8")).replace(
            /^prefix=.*$/m,
            `prefix=${vendorRoot}`,
          ),
        );
      }
      buildEnv.PKG_CONFIG_PATH = [pc, process.env.PKG_CONFIG_PATH]
        .filter(Boolean)
        .join(":");
      buildEnv.LD_LIBRARY_PATH = [vendorLib, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(":");
    }
    const worker = path.join(target, "capture");
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
        ...run(
          "pkg-config",
          [
            "--cflags",
            "--libs",
            "gstreamer-1.0",
            "gstreamer-app-1.0",
            "gstreamer-video-1.0",
            "gio-unix-2.0",
            "libpulse",
            "libpipewire-0.3",
            "x11",
            "xrandr",
            "xcomposite",
          ],
          { env: buildEnv },
        ).split(/\s+/),
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
        path.join(destination, "HauntMediaWorker"),
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
    for (const name of [
      "lib",
      "plugins",
      "pipewire",
      "spa",
      "pipewire-config",
      "bin",
    ])
      await fs.mkdir(path.join(target, name), { recursive: true });
    const copied = new Set();
    const packages = new Set();
    const sources = new Set();
    const copy = async (source, destination) => {
      if (copied.has(destination)) return;
      copied.add(destination);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
      const real = await fs.realpath(source);
      if (!vendorRoot || !real.startsWith(vendorRoot + path.sep))
        sources.add(real);
      for (const line of run("ldd", [source], { env: buildEnv }).split("\n")) {
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
    for (const line of run("ldd", [worker], { env: buildEnv }).split("\n")) {
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
      const bundled =
        vendorLib &&
        path.join(vendorLib, "gstreamer-1.0", `libgst${plugin}.so`);
      const filename =
        bundled &&
        (await fs.access(bundled).then(
          () => true,
          () => false,
        ))
          ? bundled
          : run("gst-inspect-1.0", [plugin]).match(
              /^\s*Filename\s+(\S+)$/m,
            )?.[1];
      if (!filename) throw Error(`Missing GStreamer plugin: ${plugin}`);
      await copy(
        filename,
        path.join(target, "plugins", path.basename(filename)),
      );
    }
    const inspect = vendorRoot
      ? path.join(vendorRoot, "bin/gst-inspect-1.0")
      : run("which", ["gst-inspect-1.0"]);
    const scanner = vendorRoot
      ? path.join(vendorRoot, "libexec/gstreamer-1.0/gst-plugin-scanner")
      : path.join(
          run("pkg-config", ["--variable=pluginscannerdir", "gstreamer-1.0"]),
          "gst-plugin-scanner",
        );
    await copy(inspect, path.join(target, "bin/gst-inspect-1.0"));
    await copy(scanner, path.join(target, "bin/gst-plugin-scanner"));
    if (vendorLib) {
      await copy(
        path.join(vendorLib, "libnvrtc.so"),
        path.join(target, "lib/libnvrtc.so"),
      );
      await copy(
        path.join(vendorLib, "libnvrtc-builtins.so.11.8"),
        path.join(target, "lib/libnvrtc-builtins.so.11.8"),
      );
      await fs.writeFile(
        path.join(target, "selkies-manifest.json"),
        JSON.stringify(vendorManifest, null, 2),
      );
    }
    const libdir = run("pkg-config", ["--variable=libdir", "gstreamer-1.0"]);
    for (const name of ["client-node", "protocol-native", "metadata"])
      await copy(
        path.join(libdir, "pipewire-0.3", `libpipewire-module-${name}.so`),
        path.join(target, "pipewire", `libpipewire-module-${name}.so`),
      );
    for (const name of ["libspa-support.so", "libspa-dbus.so"])
      await copy(
        path.join(libdir, "spa-0.2/support", name),
        path.join(target, "spa/support", name),
      );
    await fs.writeFile(
      path.join(target, "pipewire-config/client.conf"),
      `context.properties = { log.level = 2 }\ncontext.spa-libs = { support.* = support/libspa-support }\ncontext.modules = [ { name = libpipewire-module-protocol-native } { name = libpipewire-module-client-node } { name = libpipewire-module-metadata } ]\n`,
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
    if (vendorRoot)
      for (const name of ["LICENSE-GSTREAMER", "LICENSE-NVRTC"])
        notices += `${name}\n${await fs.readFile(path.join(vendor, name), "utf8")}\n\n`;
    await fs.writeFile(path.join(target, "NOTICE.txt"), notices);
    const archive = path.join(workspace, "runtime.tar.gz");
    run("tar", [
      "--sort=name",
      "--mtime=@0",
      "--owner=0",
      "--group=0",
      "--numeric-owner",
      "-czf",
      archive,
      "-C",
      target,
      ".",
    ]);
    const launcher = path.join(workspace, "HauntCaptureWorker");
    run("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", launcher, "."], {
      cwd: path.join(root, "native/linux-capture-launcher"),
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOOS: "linux",
        GOARCH: process.arch === "arm64" ? "arm64" : "amd64",
      },
      stdio: "inherit",
    });
    const payload = await fs.readFile(archive);
    const magic = Buffer.from("HAUNTCAPTUREv1\n");
    const footer = Buffer.alloc(8 + 32 + magic.length);
    footer.writeBigUInt64BE(BigInt(payload.length));
    createHash("sha256").update(payload).digest().copy(footer, 8);
    magic.copy(footer, 40);
    await fs.appendFile(launcher, payload);
    await fs.appendFile(launcher, footer);
    await fs.rename(launcher, path.join(destination, "HauntCaptureWorker"));
    await fs.writeFile(path.join(destination, "NOTICE.txt"), notices);
    for (const name of [
      "lib",
      "plugins",
      "pipewire",
      "spa",
      "pipewire-config",
      "bin",
    ])
      await fs.rm(path.join(destination, name), {
        recursive: true,
        force: true,
      });
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildLinuxCapture();

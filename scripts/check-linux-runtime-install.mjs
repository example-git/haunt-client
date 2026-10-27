import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { nativeRuntimeHash } from "./update-runtime.mjs";

const run = promisify(execFile);
const require = createRequire(import.meta.url);
const asar = createRequire(require.resolve("app-builder-lib"))(
  "@electron/asar",
);
const {
  compare,
  verifyManifest,
  verifyFile,
} = require("../apps/desktop/updates.cjs");
const target = `linux-${process.arch}`;
const currentDirectory = path.resolve("release/updates");
const previousDirectory = path.resolve("release/previous");
const current = JSON.parse(
  await fs.readFile(path.join(currentDirectory, `${target}.json`)),
);
const config = JSON.parse(await fs.readFile("static/updates.json"));
config.publicKey = process.env.HAUNT_UPDATE_PUBLIC_KEY || config.publicKey;

if (process.argv[2] === "prepare") {
  await fs.mkdir(previousDirectory, { recursive: true });
  const { stdout } = await run("gh", [
    "release",
    "list",
    "--repo",
    config.repository,
    "--limit",
    "100",
    "--json",
    "tagName,isDraft,isPrerelease",
  ]);
  const tag = JSON.parse(stdout)
    .filter(
      (r) =>
        !r.isDraft &&
        !r.isPrerelease &&
        /^client-v\d+\.\d+\.\d+$/.test(r.tagName),
    )
    .map((r) => r.tagName)
    .filter((t) => compare(t.slice(8), current.version) < 0)
    .sort((a, b) => compare(b.slice(8), a.slice(8)))[0];
  assert(tag, "An earlier published Linux package is required");
  await run("gh", [
    "release",
    "download",
    tag,
    "--repo",
    config.repository,
    "--pattern",
    "haunt-updates.json",
    "--dir",
    previousDirectory,
    "--clobber",
  ]);
  const previous = verifyManifest(
    JSON.parse(
      await fs.readFile(path.join(previousDirectory, "haunt-updates.json")),
    ),
    config,
    "linux",
    process.arch,
  );
  assert.equal(previous.version, tag.slice(8));
  for (const descriptor of [previous.installer, previous.rpm]) {
    assert(descriptor, "The previous release must provide both Linux formats");
    await run(
      "gh",
      [
        "release",
        "download",
        tag,
        "--repo",
        config.repository,
        "--pattern",
        descriptor.file,
        "--dir",
        previousDirectory,
        "--clobber",
      ],
      { timeout: 180000 },
    );
    await verifyFile(path.join(previousDirectory, descriptor.file), descriptor);
  }
  console.log(`Prepared verified ${tag} AppImage and RPM for upgrade testing.`);
} else {
  assert.equal(
    process.env.CI,
    "true",
    "Run package installation only in a disposable CI container",
  );
  assert.equal(process.getuid(), 0, "RPM installation requires container root");
  const previous = verifyManifest(
    JSON.parse(
      await fs.readFile(path.join(previousDirectory, "haunt-updates.json")),
    ),
    config,
    "linux",
    process.arch,
  );
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "haunt-runtime-install-"),
  );
  const report = {
    target,
    from: previous.version,
    to: current.version,
    checks: [],
  };
  const file = (directory, descriptor) => path.join(directory, descriptor.file);
  const noSystemGStreamer = async () => {
    const { stdout } = await run("ldconfig", ["-p"]);
    assert(
      !/libgst\S*\.so/.test(stdout),
      "The test host must not supply GStreamer libraries",
    );
  };
  const extract = async (image, name, legacy = false) => {
    const directory = path.join(scratch, name);
    await fs.mkdir(directory);
    await fs.chmod(image, 0o755);
    let env = process.env;
    if (legacy && process.arch === "arm64") {
      const { stdout } = await run("ldconfig", ["-p"]);
      const zlib = stdout.match(/libz\.so\.1 .* => (\S+)/)?.[1];
      assert(zlib, "The legacy AppImage extractor needs zlib");
      const libraries = path.join(directory, "legacy-libraries");
      await fs.mkdir(libraries);
      await fs.symlink(zlib, path.join(libraries, "libz.so"));
      env = { ...process.env, LD_LIBRARY_PATH: libraries };
    }
    await run(image, ["--appimage-extract"], {
      cwd: directory,
      maxBuffer: 8 * 1024 * 1024,
      env,
    });
    return path.join(directory, "squashfs-root/resources");
  };
  const unpack = async (resources, name, files) => {
    const destination = path.join(scratch, name);
    await fs.mkdir(destination);
    for (const filename of files)
      await fs.writeFile(
        path.join(destination, filename),
        asar.extractFile(
          path.join(resources, "app.asar"),
          `apps/desktop/${filename}`,
        ),
      );
    return destination;
  };
  const capture = async (resources, name) => {
    await noSystemGStreamer();
    asar.uncache(path.join(resources, "app.asar"));
    const native = path.join(resources, "native/linux");
    const installed = JSON.parse(
      asar.extractFile(path.join(resources, "app.asar"), "update-runtime.json"),
    );
    assert.equal(installed.runtime, current.runtime);
    assert.equal(await nativeRuntimeHash(native), installed.nativeRuntime);
    const module = await unpack(resources, name, [
      "linux-capture.cjs",
      "swiftcapture.cjs",
    ]);
    const { environment } = require(path.join(module, "linux-capture.cjs"));
    const binary = path.join(native, "HauntCaptureWorker");
    const libraries = await run("ldd", [binary], { env: environment(binary) });
    assert(!libraries.stdout.includes("not found"), libraries.stdout);
    assert(
      libraries.stdout.includes(path.join(native, "lib/libgstreamer-1.0.so.0")),
      libraries.stdout,
    );
    const result = await run(
      process.execPath,
      ["scripts/check-linux-capture-worker.mjs"],
      {
        env: {
          ...process.env,
          HAUNT_CAPTURE_MODULE: path.join(module, "linux-capture.cjs"),
          HAUNT_CAPTURE_WORKER: binary,
          HAUNT_CAPTURE_AUDIO_SERVER: "pipewire",
          HAUNT_EXPECT_ENCODER: "^x264enc$",
        },
        timeout: 90000,
      },
    );
    console.log(result.stdout);
    const evidence = JSON.parse(
      await fs.readFile("test-results/linux-capture-worker-x11.json"),
    );
    report.checks.push({
      name,
      systemGStreamer: false,
      nativeRuntime: installed.nativeRuntime,
      ...evidence,
    });
  };
  const update = async (format, resources, image) => {
    asar.uncache(path.join(resources, "app.asar"));
    const old = JSON.parse(
      asar.extractFile(path.join(resources, "app.asar"), "update-runtime.json"),
    );
    const hadCaptureRuntime = await fs
      .access(path.join(resources, "native/linux/HauntCaptureWorker"))
      .then(
        () => true,
        () => false,
      );
    const module = await unpack(resources, `old-updater-${format}`, [
      "updates.cjs",
    ]);
    const { Updater, createUpdateInstaller } = require(
      path.join(module, "updates.cjs"),
    );
    const keys = generateKeyPairSync("ed25519");
    const bytes = Buffer.from(
      JSON.stringify({
        schema: 1,
        repository: config.repository,
        version: current.version,
        notes: "Linux runtime installation test",
        targets: { [target]: current },
      }),
    );
    const envelope = Buffer.from(
      JSON.stringify({
        schema: 1,
        payload: bytes.toString("base64"),
        signature: sign(null, bytes, keys.privateKey).toString("base64"),
      }),
    );
    const requests = [];
    const updater = new Updater({
      directory: path.join(scratch, `updates-${format}`),
      config: {
        ...config,
        installerFormat: format,
        feedURL: "https://updates.example.test/haunt/",
        publicKey: keys.publicKey
          .export({ type: "spki", format: "pem" })
          .toString(),
      },
      runtime: old.runtime,
      version: old.version,
      getResponse: async (url) => {
        requests.push(url);
        if (new URL(url).pathname.endsWith("haunt-updates.json")) {
          const { Readable } = await import("node:stream");
          return Readable.from([envelope]);
        }
        return createReadStream(
          path.join(currentDirectory, path.basename(new URL(url).pathname)),
        );
      },
    });
    await updater.boot();
    assert.equal((await updater.check()).kind, "installer");
    assert.equal((await updater.download()).phase, "installer-ready");
    const ready = await updater.verifyReady();
    assert.equal(
      ready.info.installer.file,
      format === "rpm" ? current.rpm.file : current.installer.file,
    );
    let applied = false;
    const apply = createUpdateInstaller({
      updater,
      platform: "linux",
      appImage: image,
      readActivity: async () => ({}),
      confirm: async () => true,
      app: {
        relaunch: (options) => {
          assert.equal(options.execPath, image);
          applied = true;
        },
        quit() {},
      },
      shell: {
        openPath: async (filename) => {
          const result = await run("dnf", ["install", "-y", filename], {
            timeout: 180000,
          });
          console.log(result.stdout);
          applied = true;
          return "";
        },
      },
    });
    await apply();
    assert(applied, "The installed updater must apply the full package");
    assert(!requests.some((url) => url.endsWith(".asar")));
    if (image) await verifyFile(`${image}.haunt-previous`, previous.installer);
    report.checks.push({
      name: `${format}-update-selection`,
      previousHadCaptureRuntime: hadCaptureRuntime,
      selected: ready.info.installer.file,
      requests,
    });
  };
  try {
    for (const descriptor of [current.installer, current.rpm])
      await verifyFile(file(currentDirectory, descriptor), descriptor);
    for (const descriptor of [previous.installer, previous.rpm])
      await verifyFile(file(previousDirectory, descriptor), descriptor);
    await noSystemGStreamer();
    await capture(
      await extract(file(currentDirectory, current.installer), "fresh-image"),
      "appimage-fresh",
    );
    console.log(
      (
        await run(
          "dnf",
          ["install", "-y", file(currentDirectory, current.rpm)],
          { timeout: 180000 },
        )
      ).stdout,
    );
    await capture("/opt/Haunt/resources", "rpm-fresh");
    const image = path.join(scratch, "Haunt.AppImage");
    await fs.copyFile(file(previousDirectory, previous.installer), image);
    const oldResources = await extract(image, "old-image", true);
    await update("AppImage", oldResources, image);
    await capture(await extract(image, "updated-image"), "appimage-updated");
    console.log(
      (
        await run(
          "dnf",
          ["downgrade", "-y", file(previousDirectory, previous.rpm)],
          { timeout: 180000 },
        )
      ).stdout,
    );
    await update("rpm", "/opt/Haunt/resources");
    await capture("/opt/Haunt/resources", "rpm-updated");
    report.passed = true;
  } finally {
    await fs.mkdir("test-results", { recursive: true });
    await fs.writeFile(
      `test-results/linux-runtime-install-${process.arch}.json`,
      JSON.stringify(report, null, 2) + "\n",
    );
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

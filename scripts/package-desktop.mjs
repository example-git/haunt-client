// Existing package:desktop commands use the same slim app as installers.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const arch = process.argv[2] ?? process.arch;
if (!["x64", "arm64"].includes(arch))
  throw Error("Supported architectures: x64, arm64");
if (process.platform === "darwin" && arch !== "arm64")
  throw Error("macOS builds target Apple Silicon arm64 only.");
process.env.HAUNT_DESKTOP_ARCH = arch;
await import("./stage-electron.mjs");
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [
    require.resolve("electron-builder/cli.js"),
    "--dir",
    `--${arch}`,
    "--publish",
    "never",
  ],
  { stdio: "inherit", cwd: new URL("..", import.meta.url) },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

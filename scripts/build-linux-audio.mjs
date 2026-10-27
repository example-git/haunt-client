import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function buildLinuxAudio() {
  if (process.platform !== "linux") return;
  const target = process.env.HAUNT_DESKTOP_ARCH || process.arch;
  if (target !== process.arch)
    throw Error("Build Linux audio on the target architecture.");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = path.join(root, "release/native/linux");
  await fs.mkdir(directory, { recursive: true });
  for (const [source, binary, libraries] of [
    ["linux-audio.c", "HauntAudioWorker", ["libpulse"]],
    ["linux-shortcuts.c", "HauntShortcutWorker", ["gio-2.0", "x11"]],
  ]) {
    const flags = execFileSync(
      "pkg-config",
      ["--cflags", "--libs", ...libraries],
      {
        encoding: "utf8",
      },
    )
      .trim()
      .split(/\s+/);
    execFileSync(
      process.env.CC || "cc",
      [
        "-std=gnu11",
        "-O2",
        "-Wall",
        "-Wextra",
        "-Werror",
        path.join(root, "native", source),
        "-o",
        path.join(directory, binary),
        ...flags,
      ],
      { stdio: "inherit" },
    );
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildLinuxAudio();

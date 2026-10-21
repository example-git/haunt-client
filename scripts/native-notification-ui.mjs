import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const tesseract =
  process.platform === "win32"
    ? path.join(process.env.ProgramFiles, "Tesseract-OCR", "tesseract.exe")
    : "tesseract";
const powershell = (script) =>
  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
// Send actual OS input, including motion events, so the notification shell
// receives pointer enter/leave events instead of only a cursor-position change.
const windowsMouse = (x, y, click = false) =>
  powershell(String.raw`Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class HauntNativeInput {
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Mouse mouse; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  public static void Send(int x, int y, uint flags) {
    var input = new Input { mouse = new Mouse { x=x, y=y, flags=flags } };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
      throw new Win32Exception(Marshal.GetLastWin32Error());
  }
}
'@
$before = [System.Windows.Forms.Cursor]::Position
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
function Move-HauntPointer([int]$x, [int]$y) {
  $nx = [int][Math]::Floor(($x - $bounds.Left + 0.5) * 65536 / $bounds.Width)
  $ny = [int][Math]::Floor(($y - $bounds.Top + 0.5) * 65536 / $bounds.Height)
  [HauntNativeInput]::Send($nx, $ny, 0xE001)
  Start-Sleep -Milliseconds 100
}
Move-HauntPointer ${x} ${y}
if ($${click}) {
  [HauntNativeInput]::Send(0, 0, 2)
  Start-Sleep -Milliseconds 100
  [HauntNativeInput]::Send(0, 0, 4)
  Move-HauntPointer 10 10
}
$after = [System.Windows.Forms.Cursor]::Position
$expectedX = if ($${click}) { 10 } else { ${x} }
$expectedY = if ($${click}) { 10 } else { ${y} }
if ($after.X -ne $expectedX -or $after.Y -ne $expectedY) { throw "Native pointer did not reach its target" }
[pscustomobject]@{method='SendInput';at=[DateTime]::UtcNow.ToString('o');click=$${click};before=$before;after=$after;messageDuration=(Get-ItemProperty 'HKCU:\Control Panel\Accessibility' -ErrorAction SilentlyContinue).MessageDuration} | ConvertTo-Json -Compress`);
const linuxMouse = async (x, y) => {
  // Released xdotool versions wait 15 seconds for --sync even when the
  // pointer is already there. Check the actual destination instead.
  await run("xdotool", ["mousemove", String(x), String(y)]);
  await expect
    .poll(
      async () => {
        const { stdout } = await run("xdotool", [
          "getmouselocation",
          "--shell",
        ]);
        return {
          x: Number(stdout.match(/^X=(\d+)$/m)?.[1]),
          y: Number(stdout.match(/^Y=(\d+)$/m)?.[1]),
        };
      },
      { timeout: 2000 },
    )
    .toEqual({ x, y });
};
const literal = (value) => `'${value.replaceAll("'", "''")}'`;
const nativeFocusPages = new WeakMap();

export async function useNativeWindowFocus(page) {
  // Playwright enables focus emulation by default. Remove that automation
  // override so minimization, hiding and OS popup clicks control real focus.
  if (!nativeFocusPages.has(page)) {
    // Emulation belongs to its CDP session: a second session cannot clear it.
    // Use the owning session from the pinned Playwright version and fail if
    // its internals change, rather than silently retaining simulated focus.
    const session =
      page._connection.toImpl(page)?.delegate?._mainFrameSession?._client;
    if (!session) throw Error("Cannot disable Playwright's focus emulation");
    await session.send("Emulation.setFocusEmulationEnabled", {
      enabled: false,
    });
    nativeFocusPages.set(page, session);
  }
}

export async function captureDesktop(filename) {
  if (process.platform === "darwin")
    await run("screencapture", ["-x", filename]);
  else if (process.platform === "linux")
    await run("import", ["-window", "root", filename]);
  else
    await powershell(`Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width,$bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try { $graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size); $bitmap.Save(${literal(path.resolve(filename))},[System.Drawing.Imaging.ImageFormat]::Png) } finally { $graphics.Dispose(); $bitmap.Dispose() }`);
}

export function nativeNotificationUI(target, { clickButton = 1 } = {}) {
  let sequence = 0;
  let scaleFactor = 1;
  const artifacts = [];
  const normalize = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const read = async (wanted, additionalRegions = []) => {
    await fs.mkdir("test-results", { recursive: true });
    const screen = `test-results/notification-${target}-current.png`;
    const crop = `test-results/notification-${target}-popup.png`;
    await captureDesktop(screen);
    // Haunt occupies the left 600 logical pixels. Only actual OS notification
    // windows or the area outside Haunt can satisfy the visual assertion.
    const convert = process.platform === "linux" ? "convert" : "magick";
    const offset = Math.round(600 * scaleFactor);
    const regions = [];
    if (process.platform === "linux") {
      const ids = await run("xdotool", [
        "search",
        "--onlyvisible",
        "--class",
        target.startsWith("fedora-") ? "plasmashell" : "Dunst",
      ])
        .then(({ stdout }) => stdout.trim().split(/\s+/).filter(Boolean))
        .catch((error) => {
          if (error.code === 1) return [];
          throw error;
        });
      for (const id of ids) {
        const { stdout } = await run("xdotool", [
          "getwindowgeometry",
          "--shell",
          id,
        ]);
        const box = Object.fromEntries(
          stdout
            .trim()
            .split("\n")
            .map((line) => {
              const [key, value] = line.split("=");
              return [key, Number(value)];
            }),
        );
        if (
          box.X < offset ||
          box.Y < 0 ||
          box.WIDTH > 650 * scaleFactor ||
          box.WIDTH < 20 ||
          box.HEIGHT < 20
        )
          continue;
        regions.push({
          x: box.X,
          y: box.Y,
          width: box.WIDTH,
          height: box.HEIGHT,
          zoom: 3,
        });
        // Separate text columns from large notification artwork. Each OCR
        // attempt still reads the captured native pixels and matches all words.
        const column = Math.floor(box.WIDTH * 0.8);
        regions.push({
          x: box.X,
          y: box.Y,
          width: column,
          height: box.HEIGHT,
          zoom: 3,
        });
        regions.push({
          x: box.X + box.WIDTH - column,
          y: box.Y,
          width: column,
          height: box.HEIGHT,
          zoom: 3,
        });
        for (const width of [box.WIDTH, column])
          regions.push({
            x: box.X,
            y: box.Y,
            width,
            height: box.HEIGHT,
            zoom: 3,
            psm: 11,
          });
      }
    } else regions.push({ x: offset, y: 0, zoom: 1 }, ...additionalRegions);
    const readings = [];
    for (const region of regions) {
      const geometry = `${region.width ? `${region.width}x${region.height}` : ""}+${region.x}+${region.y}`;
      await run(convert, [
        screen,
        "-crop",
        geometry,
        "+repage",
        ...(region.zoom > 1
          ? ["-resize", `${region.zoom * 100}%`, "-colorspace", "gray"]
          : []),
        crop,
      ]);
      const { stdout } = await run(
        tesseract,
        [
          crop,
          "stdout",
          ...(region.psm ? ["--psm", String(region.psm)] : []),
          "tsv",
        ],
        {
          maxBuffer: 2 * 1024 * 1024,
          env: { ...process.env, OMP_THREAD_LIMIT: "1" },
        },
      );
      const words = stdout
        .trim()
        .split("\n")
        .slice(1)
        .map((line) => {
          const parts = line.split("\t");
          return {
            x: Number(parts[6]) / region.zoom + region.x,
            y: Number(parts[7]) / region.zoom + region.y,
            width: Number(parts[8]) / region.zoom,
            height: Number(parts[9]) / region.zoom,
            text: parts.slice(11).join("\t").trim(),
          };
        })
        .filter((word) => word.text);
      const text = normalize(words.map((word) => word.text).join(" "));
      readings.push({ region, words, text });
      if (wanted && text.includes(normalize(wanted))) break;
    }
    await fs.writeFile(
      `test-results/notification-${target}-ocr.json`,
      JSON.stringify({ readings, scaleFactor }, null, 2),
    );
    return {
      screen,
      words: readings.at(-1)?.words ?? [],
      text: readings.map(({ text }) => text).join(" "),
    };
  };
  const retain = async (state, label) => {
    const file = `test-results/notification-${target}-${++sequence}-${label}.png`;
    await fs.copyFile(state.screen, file);
    artifacts.push(file);
  };
  const find = async (text) => {
    let state;
    let attempts = 0;
    await expect
      .poll(
        async () => {
          state = await read(text);
          if (++attempts <= 2) await retain(state, "search");
          if (state.words.length && !state.text.includes(normalize(text))) {
            await fs.copyFile(
              state.screen,
              `test-results/notification-${target}-unmatched.png`,
            );
            await fs.copyFile(
              `test-results/notification-${target}-ocr.json`,
              `test-results/notification-${target}-unmatched.json`,
            );
          }
          return state.text.includes(normalize(text));
        },
        { timeout: 30000, intervals: [150, 250, 500] },
      )
      .toBe(true);
    return state;
  };
  return {
    target,
    artifacts,
    setScaleFactor(value) {
      scaleFactor = value;
    },
    capture: captureDesktop,
    async movePointerAway() {
      if (process.platform === "win32") {
        const result = await windowsMouse(10, 10);
        await fs.appendFile(
          `test-results/notification-${target}-pointer.jsonl`,
          result.stdout,
        );
      } else if (process.platform === "linux") await linuxMouse(10, 10);
      else await run("cliclick", ["m:10,10"]);
    },
    async diagnose() {
      const commands =
        process.platform === "darwin"
          ? [
              ["defaults", ["read", "com.apple.ncprefs"]],
              [
                "log",
                [
                  "show",
                  "--last",
                  "3m",
                  "--info",
                  "--debug",
                  "--style",
                  "compact",
                  "--predicate",
                  'process == "usernoted" OR process == "NotificationCenter"',
                ],
              ],
            ]
          : process.platform === "linux"
            ? [
                ["xwininfo", ["-root", "-tree"]],
                ["dunstctl", ["is-paused"]],
                ["dunstctl", ["history"]],
              ]
            : [];
      const results = [];
      for (const [command, args] of commands) {
        try {
          results.push({
            command,
            args,
            ...(await run(command, args, {
              timeout: 10000,
              maxBuffer: 8 * 1024 * 1024,
            })),
          });
        } catch (error) {
          results.push({
            command,
            args,
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr,
          });
        }
      }
      if (process.platform === "darwin") {
        await run("open", [
          "x-apple.systempreferences:com.apple.preference.notifications?id=com.exampleuser.haunt",
        ]);
        await new Promise((resolve) => setTimeout(resolve, 4000));
        await captureDesktop(
          `test-results/notification-${target}-system-settings.png`,
        );
      }
      await fs.writeFile(
        `test-results/notification-${target}-system.json`,
        JSON.stringify(results, null, 2),
      );
      return `test-results/notification-${target}-system.json`;
    },
    async allowNotifications() {
      if (process.platform !== "darwin") return;
      let optionsOpened = false;
      let menuRegion;
      await expect
        .poll(
          async () => {
            const state = await read(undefined, menuRegion ? [menuRegion] : []);
            const permissionNotice =
              state.text.includes("haunt") &&
              (state.text.includes("would like to send you notifications") ||
                state.text.includes("notifications may include alerts"));
            if (!permissionNotice && !optionsOpened) return false;
            const allow = state.words.find(
              (word, index) =>
                normalize(word.text) === "allow" &&
                !["don t", "dont"].includes(
                  normalize(state.words[index - 1]?.text ?? ""),
                ),
            );
            const options = state.words.find(
              (word) => normalize(word.text) === "options",
            );
            const title = state.words.find(
              (word) => normalize(word.text) === "haunt",
            );
            const button = allow || (!optionsOpened && options);
            const word = button || title;
            if (!word) return false;
            await retain(state, allow ? "permission-allow" : "permission");
            await run("cliclick", [
              `${button ? "c" : "m"}:${Math.round((word.x + word.width / 2) / scaleFactor)},${Math.round((word.y + word.height / 2) / scaleFactor)}`,
            ]);
            if (options && button === options) {
              optionsOpened = true;
              // Read the menu separately: the system's small Allow/Don't Allow
              // labels overlap other notifications in a full-screen OCR pass.
              menuRegion = {
                x: Math.max(0, Math.round(options.x - 16 * scaleFactor)),
                y: Math.round(options.y + options.height),
                width: Math.round(120 * scaleFactor),
                height: Math.round(80 * scaleFactor),
                zoom: 3,
                psm: 6,
              };
            }
            return Boolean(allow);
          },
          { timeout: 30000, intervals: [250, 500] },
        )
        .toBe(true);
    },
    async expectPopup(text, { hover = false } = {}) {
      const state = await find(text);
      await retain(state, "visible");
      if (hover) {
        // Hold the real popup under the pointer while badge/audio evidence is
        // collected, just as a user does before clicking a transient banner.
        const word = state.words.find(
          (word) => normalize(word.text) === normalize(text).split(" ")[0],
        );
        if (!word) throw Error(`Cannot hover the native popup: ${text}`);
        const scale = process.platform === "darwin" ? scaleFactor : 1;
        const x = Math.round((word.x + word.width / 2) / scale);
        const y = Math.round((word.y + word.height / 2) / scale);
        if (process.platform === "linux") await linuxMouse(x, y);
        else if (process.platform === "darwin")
          await run("cliclick", [`m:${x},${y}`]);
        else await windowsMouse(x, y);
      }
    },
    async expectNoPopup(text) {
      let state;
      const until = Date.now() + 4000;
      do {
        state = await read(text);
        expect(state.text, `No desktop popup containing ${text}`).not.toContain(
          normalize(text),
        );
      } while (Date.now() < until);
      await retain(state, "absent");
    },
    async clickPopup(text) {
      const state = await find(text);
      const wanted = normalize(text).split(" ");
      const word = state.words.find(
        (word, index) =>
          normalize(
            state.words
              .slice(index, index + wanted.length)
              .map((w) => w.text)
              .join(" "),
          ) === normalize(text),
      );
      if (!word)
        throw Error(
          `Cannot locate the native notification click target: ${text}`,
        );
      const coordinateScale = process.platform === "darwin" ? scaleFactor : 1;
      const x = Math.round((word.x + word.width / 2) / coordinateScale),
        y = Math.round((word.y + word.height / 2) / coordinateScale);
      await fs.writeFile(
        `test-results/notification-${target}-click.json`,
        JSON.stringify({ text, x, y, word, scaleFactor }, null, 2),
      );
      await retain(state, "click");
      if (process.platform === "linux") {
        await linuxMouse(x, y);
        await run("xdotool", [
          "sleep",
          "0.15",
          "click",
          String(clickButton),
          "sleep",
          "0.15",
        ]);
        await linuxMouse(10, 10);
      } else if (process.platform === "darwin")
        await run("cliclick", [`c:${x},${y}`, "m:10,10"]);
      else await windowsMouse(x, y, true);
    },
  };
}

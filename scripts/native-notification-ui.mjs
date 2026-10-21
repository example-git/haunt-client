import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const powershell = (script) =>
  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    Buffer.from(script, "utf16le").toString("base64"),
  ]);
const literal = (value) => `'${value.replaceAll("'", "''")}'`;

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
  const read = async () => {
    await fs.mkdir("test-results", { recursive: true });
    const screen = `test-results/notification-${target}-current.png`;
    const crop = `test-results/notification-${target}-popup.png`;
    await captureDesktop(screen);
    // The real Haunt window is confined to the left 600px. Inspect only the
    // desktop notification area, so chat content cannot satisfy a popup check.
    const convert = process.platform === "linux" ? "convert" : "magick";
    const offset = Math.round(600 * scaleFactor);
    await run(convert, [screen, "-crop", `+${offset}+0`, "+repage", crop]);
    const { stdout } = await run("tesseract", [crop, "stdout", "tsv"], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const words = stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const parts = line.split("\t");
        return {
          x: Number(parts[6]) + offset,
          y: Number(parts[7]),
          width: Number(parts[8]),
          height: Number(parts[9]),
          text: parts.slice(11).join("\t"),
        };
      })
      .filter((word) => word.text);
    return {
      screen,
      words,
      text: normalize(words.map((word) => word.text).join(" ")),
    };
  };
  const retain = async (state, label) => {
    const file = `test-results/notification-${target}-${++sequence}-${label}.png`;
    await fs.copyFile(state.screen, file);
    artifacts.push(file);
  };
  const find = async (text) => {
    let state;
    await expect
      .poll(
        async () => {
          state = await read();
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
    async expectPopup(text) {
      const state = await find(text);
      await retain(state, "visible");
    },
    async expectNoPopup(text) {
      let state;
      const until = Date.now() + 4000;
      do {
        state = await read();
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
      if (process.platform === "linux")
        await run("xdotool", [
          "mousemove",
          String(x),
          String(y),
          "click",
          String(clickButton),
        ]);
      else if (process.platform === "darwin")
        await run("cliclick", [`c:${x},${y}`]);
      else
        await powershell(
          `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class HauntMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }'; [HauntMouse]::SetCursorPos(${x},${y}); [HauntMouse]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [HauntMouse]::mouse_event(4,0,0,0,[UIntPtr]::Zero)`,
        );
    },
  };
}

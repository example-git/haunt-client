import { _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

let activeCleanup;
export async function cleanupScreen() {
  await activeCleanup?.();
}
export async function checkScreen(executablePath, afterCheck) {
  const scratch = await fs.mkdtemp(
    path.join(os.tmpdir(), "chatxo-capture-test-"),
  );
  const xvfb = spawn(
    "Xvfb",
    ["-displayfd", "1", "-screen", "0", "1280x900x24", "-nolisten", "tcp"],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  xvfb.stderr.on("data", () => {});
  let desktop,
    cleaning,
    wm,
    captureWindow,
    diagnostics = "";
  const cleanup = () =>
    (cleaning ??= (async () => {
      let closeError, closeTimer;
      try {
        await Promise.race([
          desktop?.close(),
          new Promise((_, reject) => {
            closeTimer = setTimeout(
              () =>
                reject(Error("Owned Electron did not exit within 15 seconds")),
              15000,
            );
          }),
        ]);
      } catch (error) {
        closeError = error;
        desktop?.process().kill("SIGKILL");
      } finally {
        clearTimeout(closeTimer);
      }
      for (const child of [captureWindow, wm, xvfb]) {
        if (!child?.pid) continue;
        const signal = (value) => {
          try {
            process.kill(-child.pid, value);
          } catch (error) {
            if (error.code !== "ESRCH") throw error;
          }
        };
        const exited =
          child.exitCode === null && child.signalCode === null
            ? once(child, "exit")
            : Promise.resolve();
        let timer;
        signal("SIGTERM");
        try {
          await Promise.race([
            exited,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 2000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
          signal("SIGKILL");
        }
        await exited;
      }
      await fs.rm(scratch, { recursive: true, force: true });
      if (closeError) throw closeError;
    })());
  activeCleanup = cleanup;
  try {
    const display = await new Promise((resolve, reject) => {
      let data = "";
      const timer = setTimeout(
        () => reject(Error("Xvfb did not start")),
        10000,
      );
      xvfb.stdout.on("data", (chunk) => {
        data += chunk;
        if (data.includes("\n")) {
          clearTimeout(timer);
          resolve(data.trim());
        }
      });
      xvfb.once("error", reject);
    });
    // Window enumeration on X11 needs an actual window manager. This one owns
    // only our private Xvfb display and is torn down by its dedicated group.
    const displayEnv = {
      ...process.env,
      DISPLAY: `:${display}`,
      WAYLAND_DISPLAY: "",
      DBUS_SESSION_BUS_ADDRESS: "",
      SESSION_MANAGER: "",
      GDK_BACKEND: "x11",
      LIBGL_ALWAYS_SOFTWARE: "1",
      XDG_CONFIG_HOME: path.join(scratch, "wm-config"),
      XDG_CACHE_HOME: path.join(scratch, "wm-cache"),
    };
    wm = spawn(
      "dbus-run-session",
      ["--", "xfwm4", "--compositor=off", "--vblank=off"],
      {
        env: displayEnv,
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    wm.stderr.on("data", (data) =>
      process.stderr.write(String(data).slice(0, 1500)),
    );
    if (!afterCheck)
      captureWindow = spawn(
        "xmessage",
        [
          "-name",
          "Haunt owned capture fixture",
          "-geometry",
          "800x450+0+0",
          "-bg",
          "#1234ee",
          "Owned window capture test",
        ],
        { env: displayEnv, detached: true, stdio: "ignore" },
      );
    desktop = await electron.launch({
      ...(executablePath ? { executablePath } : {}),
      args: [
        "--no-sandbox",
        ...(afterCheck
          ? [
              "--use-fake-device-for-media-stream",
              `--use-file-for-fake-audio-capture=${path.resolve("tests/fixtures/noise-speech.wav")}`,
            ]
          : []),
        "--password-store=basic",
        "--ozone-platform=x11",
        "--disable-features=WebRTCPipeWireCapturer",
        ...(executablePath ? [] : [path.resolve("apps/desktop/main.cjs")]),
      ],
      env: {
        ...process.env,
        DISPLAY: `:${display}`,
        WAYLAND_DISPLAY: "",
        XDG_SESSION_TYPE: "x11",
        LIBGL_ALWAYS_SOFTWARE: "1",
        DBUS_SESSION_BUS_ADDRESS: "",
        XDG_CONFIG_HOME: path.join(scratch, "config"),
        XDG_CACHE_HOME: path.join(scratch, "cache"),
        HAUNT_DESKTOP_TEST: "1",
        HAUNT_DESKTOP_TEST_PROFILE: path.join(scratch, "desktop"),
      },
      timeout: 30000,
    });
    desktop.process().stdout.on("data", (data) => process.stdout.write(data));
    if (process.env.HAUNT_DESKTOP_SHUTDOWN_TRACE === "1")
      await desktop.evaluate(({ app, BrowserWindow }) => {
        for (const event of ["before-quit", "will-quit", "quit"])
          app.on(event, () => console.log(`Desktop shutdown: ${event}`));
        for (const window of BrowserWindow.getAllWindows())
          window.on("closed", () =>
            console.log("Desktop shutdown: window closed"),
          );
      });
    desktop.process().stderr.on("data", (data) => {
      diagnostics = (diagnostics + data).slice(-24000);
      if (String(data).includes("CAPTURE")) process.stderr.write(data);
    });
    assert(
      (await desktop.evaluate(({ app }) => app.getPath("userData"))).startsWith(
        scratch + path.sep,
      ),
    );
    await desktop.evaluate(({ app, dialog, desktopCapturer }) => {
      app.on("render-process-gone", (_event, _contents, details) =>
        console.error("CAPTURE renderer exit", JSON.stringify(details)),
      );
      app.on("child-process-gone", (_event, details) =>
        console.error("CAPTURE child exit", JSON.stringify(details)),
      );
      globalThis.captureDiagnostics = { pickerCalls: 0, sourceCalls: 0 };
      dialog.showMessageBox = async () => {
        globalThis.captureDiagnostics.pickerCalls++;
        return { response: 1, checkboxChecked: false };
      };
      const original = desktopCapturer.getSources.bind(desktopCapturer);
      desktopCapturer.getSources = async (options) => {
        globalThis.captureDiagnostics.sourceCalls++;
        try {
          // A newly created private Xvfb screen can temporarily disappear
          // between Chromium catalog calls. Wait only for this test's display;
          // still return real sources and capture real pixels through the picker.
          let sources = await original(options);
          for (let attempt = 0; !sources.length && attempt < 20; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            sources = await original(options);
          }
          globalThis.captureDiagnostics.sources = sources.map((s) => ({
            id: s.id,
            name: s.name,
          }));
          return sources;
        } catch (error) {
          globalThis.captureDiagnostics.error = error.message;
          throw error;
        }
      };
    });
    let sourceKind = "screen";
    let pickerError;
    desktop.on("window", async (picker) => {
      try {
        await picker.waitForLoadState("domcontentloaded");
        if (!picker.url().endsWith("capture-picker.html")) return;
        if (desktop.manualCapturePicker) return;
        await desktop.evaluate(
          () => globalThis.captureDiagnostics.pickerCalls++,
        );
        if (sourceKind === "cancel")
          await picker
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
        else
          await picker
            .locator(`button.source[data-kind="${sourceKind}"]`)
            .first()
            .click();
      } catch (error) {
        pickerError = error;
      }
    });
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(15000);
    await page
      .getByRole("button", { name: "Join a server", exact: true })
      .waitFor();
    // Focused UI checks reuse this owned desktop/display with fake microphone
    // capture. The default path below separately verifies real screen pixels.
    if (afterCheck) {
      await afterCheck(page, desktop);
      return;
    }
    // The private X server can be ready before Chromium's display catalog.
    // Wait for this owned display, then still exercise the real source picker.
    await desktop.evaluate(async ({ desktopCapturer }) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (sources.length) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error(
        "The owned Xvfb display did not appear in the capture catalog",
      );
    });
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.textContent = "Test owned screen";
      button.addEventListener("click", () => {
        window.captureResult = (async () => {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false,
          });
          const video = document.createElement("video");
          video.muted = true;
          video.srcObject = stream;
          try {
            await video.play();
            await new Promise((resolve) => setTimeout(resolve, 500));
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext("2d");
            context.drawImage(video, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let bluePixels = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i + 2] > pixels[i + 1] + 3) bluePixels++;
            return { width: canvas.width, height: canvas.height, bluePixels };
          } finally {
            stream.getTracks().forEach((track) => track.stop());
            video.pause();
            video.srcObject = null;
          }
        })().catch((error) => ({ error: error.message }));
      });
      document.body.append(button);
      Object.assign(button.style, {
        position: "fixed",
        top: "0",
        left: "80px",
        zIndex: "100",
        background: "#1234ee",
        width: "240px",
        height: "60px",
      });
    });
    for (sourceKind of ["screen", "window", "cancel"]) {
      await page
        .getByRole("button", { name: "Test owned screen", exact: true })
        .click();
      let timer;
      const capture = await Promise.race([
        page.evaluate(() => window.captureResult),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Screen capture timed out")),
            15000,
          );
        }),
      ])
        .catch(async (error) => {
          console.log(
            "Capture failure",
            sourceKind,
            pickerError?.message,
            await desktop.evaluate(() => globalThis.captureDiagnostics),
            await Promise.all(
              desktop.windows().map(async (p) => ({
                url: p.url(),
                text: await p
                  .locator("body")
                  .innerText()
                  .catch(() => "closed"),
              })),
            ),
          );
          throw error;
        })
        .finally(() => clearTimeout(timer));
      if (pickerError) throw pickerError;
      if (sourceKind === "cancel") {
        assert(capture.error, "Cancellation must not capture a source");
        continue;
      }
      const diagnostics = await desktop.evaluate(
        () => globalThis.captureDiagnostics,
      );
      if (capture.error) console.log("Owned capture diagnostics:", diagnostics);
      assert(!capture.error, capture.error);
      assert(capture.width >= 600 && capture.height >= 400);
      assert(
        capture.bluePixels > 1000,
        "Must capture actual application pixels",
      );
      assert(
        diagnostics.pickerCalls > 0,
        "Must exercise the application source picker",
      );
      console.log(
        `PASS native Electron ${sourceKind} thumbnail selection and actual captured pixels`,
      );
    }
    console.log("PASS native Electron picker cancellation");
  } catch (error) {
    console.error("Owned Electron diagnostics:", diagnostics);
    throw error;
  } finally {
    await cleanup();
    activeCleanup = undefined;
  }
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(
      signal,
      () => void cleanupScreen().finally(() => process.exit(1)),
    );
  await checkScreen(process.argv[2]);
}

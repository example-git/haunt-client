const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("node:path");

function installLinuxAudio({ app, ipcMain, parent, validateSender }) {
  if (process.platform !== "linux") return;
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, "native/linux/HauntAudioWorker")
    : path.join(__dirname, "../../release/native/linux/HauntAudioWorker");
  let selection, active;
  const send = (value) => {
    if (!parent.isDestroyed())
      parent.webContents.send("linux-audio:event", value);
  };
  const stop = () => {
    selection = undefined;
    if (!active) return;
    const capture = active;
    active = undefined;
    capture.child.kill("SIGTERM");
    const timeout = setTimeout(() => capture.child.kill("SIGKILL"), 1500);
    timeout.unref();
    capture.child.once("exit", () => clearTimeout(timeout));
  };
  const outputs = async () => {
    try {
      const { stdout } = await promisify(execFile)(binary, ["list"], {
        timeout: 5000,
        maxBuffer: 256 * 1024,
      });
      const rows = JSON.parse(stdout);
      if (
        !Array.isArray(rows) ||
        rows.length > 256 ||
        rows.some(
          (row) =>
            typeof row.id !== "string" ||
            row.id.length > 1024 ||
            typeof row.label !== "string",
        )
      )
        throw Error("Invalid audio output catalog");
      return { outputs: rows };
    } catch (error) {
      return {
        outputs: [],
        error:
          error.code === "ENOENT"
            ? "The Linux audio helper is missing. Reinstall Haunt to enable share audio."
            : "Cannot connect to audio outputs. Start the PulseAudio or PipeWire PulseAudio service.",
      };
    }
  };
  ipcMain.handle("linux-audio:start", async (event, id) => {
    validateSender(event);
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
      throw Error("Invalid audio capture");
    const chosen = selection;
    selection = undefined;
    if (!chosen) return null;
    if (Date.now() - chosen.at > 30000)
      throw Error("Select a screen and audio output again.");
    stop();
    const child = spawn(binary, ["record", chosen.id], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const capture = (active = { id, child, pending: 0 });
    let buffer = Buffer.alloc(0),
      errors = "",
      ready = false;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        stop();
        reject(Error("Audio output did not start."));
      }, 8000);
      const failed = (message) => {
        clearTimeout(timeout);
        if (active !== capture) {
          if (!ready) reject(Error("Audio capture stopped."));
          return;
        }
        stop();
        if (!ready) reject(Error(message));
        else send({ id, error: message });
      };
      child.once("error", (error) =>
        failed(`Audio capture failed: ${error.message}`),
      );
      child.once("exit", () =>
        failed(
          errors.replace(/^READY\s*/, "").trim() ||
            "The selected audio output stopped.",
        ),
      );
      child.stderr.on("data", (data) => {
        errors = (errors + data).slice(-4000);
        if (!ready && errors.includes("READY\n")) {
          ready = true;
          clearTimeout(timeout);
          resolve();
        }
      });
      child.stdout.on("data", (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 7680) {
          const packet = buffer.subarray(0, 7680);
          buffer = buffer.subarray(7680);
          if (active !== capture || capture.pending >= 8) continue;
          capture.pending++;
          const samples = new Float32Array(1920);
          for (let i = 0; i < samples.length; i++)
            samples[i] = packet.readFloatLE(i * 4);
          send({ id, data: samples });
        }
      });
    });
    return { label: chosen.label };
  });
  ipcMain.on("linux-audio:ack", (event, id) => {
    try {
      validateSender(event);
    } catch {
      return;
    }
    if (active?.id === id) active.pending = Math.max(0, active.pending - 1);
  });
  ipcMain.handle("linux-audio:stop", (event, id) => {
    validateSender(event);
    if (active?.id === id) stop();
  });
  parent.webContents.on(
    "did-start-navigation",
    (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) stop();
    },
  );
  parent.webContents.on("render-process-gone", stop);
  parent.on("closed", stop);
  app.on("before-quit", stop);
  return {
    outputs,
    select(output) {
      selection = output ? { ...output, at: Date.now() } : undefined;
    },
  };
}
module.exports = { installLinuxAudio };

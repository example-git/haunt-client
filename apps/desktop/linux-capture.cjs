const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Capture } = require("./swiftcapture.cjs");
const { captureDiagnostics } = require("./capture-diagnostics.cjs");

function environment() {
  return { ...process.env };
}

async function listSources(binary) {
  try {
    const { stdout, stderr } = await promisify(execFile)(
      binary,
      ["--list-sources"],
      {
        timeout: 15000,
        maxBuffer: 2 * 1024 * 1024,
        env: environment(binary),
      },
    );
    if (stderr) captureDiagnostics.record("sources", "worker", stderr);
    const result = JSON.parse(stdout);
    if (!Array.isArray(result.screens) || !Array.isArray(result.audioSources))
      throw Error("Invalid Linux capture source catalog");
    if (result.audioError)
      captureDiagnostics.record("sources", "audio-error", result.audioError);
    return result;
  } catch (error) {
    captureDiagnostics.record("sources", "failure", error.message);
    throw error;
  }
}

class LinuxCapture extends Capture {
  constructor(binary, options) {
    if (
      !/^(?:(?:screen|window):\d+:0|portal:(?:screen|window))$/.test(
        options.source,
      )
    )
      throw Error("Invalid Linux capture source");
    super(binary, options, {
      args: [
        "--capture",
        options.source,
        String(options.width),
        String(options.height),
        String(options.fps),
        ...(options.audioSource ? [options.audioSource] : []),
      ],
      env: environment(binary),
      stallTimeout: 30000,
    });
  }

  configure(mode) {
    if (this.closed) return Promise.reject(Error("Capture source ended"));
    this.report("configure", mode);
    return new Promise((resolve, reject) => {
      const done = (error, config) => {
        clearTimeout(timer);
        this.removeListener("video-config", configured);
        this.removeListener("failure", failed);
        this.removeListener("stopped", stopped);
        error ? reject(error) : resolve(config);
      };
      const configured = (config) => done(null, config);
      const failed = (error) => done(error);
      const stopped = () => done(Error("Capture source ended"));
      const timer = setTimeout(() => {
        const error = Error("Capture mode change timed out");
        this.fail(error);
      }, 15000);
      this.once("video-config", configured);
      this.once("failure", failed);
      this.once("stopped", stopped);
      this.child.stdin.write(
        `configure ${mode.width} ${mode.height} ${mode.fps}\n`,
      );
    });
  }
}

module.exports = { LinuxCapture, listSources, environment };

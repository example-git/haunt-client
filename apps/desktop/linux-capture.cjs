const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { Capture } = require("./swiftcapture.cjs");

function environment() {
  return { ...process.env };
}

async function listSources(binary) {
  const { stdout } = await promisify(execFile)(binary, ["--list-sources"], {
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    env: environment(binary),
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result.screens) || !Array.isArray(result.audioSources))
    throw Error("Invalid Linux capture source catalog");
  return result;
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
    });
  }

  configure(mode) {
    if (this.closed) return Promise.reject(Error("Capture source ended"));
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
        done(error);
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

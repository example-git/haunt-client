const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

function createMacInstaller(app) {
  const state = path.join(
    os.homedir(),
    "Library/Application Support/Haunt Local Signing/identity.plist",
  );
  const resources = path.join(process.resourcesPath, "local-install");
  return {
    async configured() {
      if (process.platform !== "darwin") return false;
      try {
        return (await fs.lstat(state)).isFile();
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
    async prepare(filename, progress = () => {}) {
      const destination = path.resolve(
        path.dirname(app.getPath("exe")),
        "../..",
      );
      if (path.basename(destination) !== "Haunt.app")
        throw Error("Haunt's installed application path is unavailable.");
      const scratch = await fs.mkdtemp(
        path.join(os.tmpdir(), "haunt-update-mount-"),
      );
      const mount = path.join(scratch, "volume");
      await fs.mkdir(mount);
      let mounted = false;
      try {
        await run("/usr/bin/hdiutil", [
          "attach",
          "-readonly",
          "-nobrowse",
          "-mountpoint",
          mount,
          filename,
        ]);
        mounted = true;
        const stdout = await new Promise((resolve, reject) => {
          const child = spawn("/bin/bash", [
            path.join(resources, "Install Haunt.command"),
            "--prepare-update",
            "--destination",
            destination,
            path.join(mount, "Haunt.app"),
          ]);
          let output = "",
            errors = "",
            pending = "";
          child.stdout.setEncoding("utf8").on("data", (data) => {
            output += data;
          });
          child.stderr.setEncoding("utf8").on("data", (data) => {
            errors = (errors + data).slice(-16384);
            pending += data;
            const lines = pending.split("\n");
            pending = lines.pop();
            for (const line of lines) {
              const [prefix, message, completed, total] = line.split("\t");
              if (prefix === "HAUNT_PROGRESS")
                progress({
                  message,
                  progress:
                    Number(total) > 0
                      ? Number(completed) / Number(total)
                      : undefined,
                });
            }
          });
          const timeout = setTimeout(() => {
            child.kill();
            reject(
              Error("Local signing timed out. The installed app is unchanged."),
            );
          }, 300_000);
          child.once("error", (error) => {
            clearTimeout(timeout);
            reject(error);
          });
          child.once("exit", (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve(output);
            else reject(Error(`Local signing failed: ${errors.trim()}`));
          });
        });
        const staged = stdout.trim();
        if (
          path.dirname(path.dirname(staged)) !==
            path.join(path.dirname(state), "staging") ||
          !path.basename(path.dirname(staged)).startsWith("haunt-install.") ||
          path.basename(staged) !== "Haunt.app"
        )
          throw Error("The local installer returned an invalid staging path.");
        const helper = path.join(path.dirname(staged), "finish-update.sh");
        await fs.copyFile(path.join(resources, "finish-update.sh"), helper);
        await fs.copyFile(
          path.join(resources, "commit-install.sh"),
          path.join(path.dirname(staged), "commit-install.sh"),
        );
        return { destination, staged, helper };
      } finally {
        if (mounted) await run("/usr/bin/hdiutil", ["detach", mount]);
        await fs.rm(scratch, { recursive: true, force: true });
      }
    },
    async finish(prepared) {
      const log = await fs.open(
        path.join(path.dirname(state), "last-update.log"),
        "w",
        0o600,
      );
      try {
        const child = spawn(
          "/bin/bash",
          [
            prepared.helper,
            String(process.pid),
            prepared.destination,
            prepared.staged,
            ...process.argv.slice(1),
          ],
          {
            detached: true,
            stdio: ["ignore", log.fd, log.fd],
          },
        );
        await new Promise((resolve, reject) => {
          let settled = false;
          const timeout = setTimeout(() => {
            settled = true;
            child.kill();
            reject(
              Error(
                "The installation permission request timed out; Haunt has not been replaced.",
              ),
            );
          }, 300_000);
          const check = async () => {
            if (settled) return;
            try {
              await fs.stat(
                path.join(path.dirname(prepared.staged), "ready-to-replace"),
              );
              settled = true;
              clearTimeout(timeout);
              resolve();
            } catch (error) {
              if (error.code !== "ENOENT") {
                settled = true;
                clearTimeout(timeout);
                reject(error);
              } else setTimeout(check, 100);
            }
          };
          child.once("error", (error) => {
            settled = true;
            clearTimeout(timeout);
            reject(error);
          });
          child.once("exit", (code) => {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              reject(
                Error(
                  `Installation was cancelled or failed (exit ${code}). The current app is still running. See Haunt Local Signing/last-update.log.`,
                ),
              );
            }
          });
          void check();
        });
        child.unref();
      } catch (error) {
        await fs.writeFile(
          path.join(path.dirname(prepared.staged), "cancelled"),
          "Installation cancelled before app exit.\n",
          { mode: 0o600 },
        );
        throw error;
      } finally {
        await log.close();
      }
    },
  };
}
module.exports = { createMacInstaller };

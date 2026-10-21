const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const desktopName = "com.exampleuser.haunt.desktop";
const appId = desktopName.slice(0, -8);
const managed = "X-Haunt-Managed=true";
const escapeValue = (value) => value.replaceAll("\\", "\\\\");
function executable(value) {
  if (!path.isAbsolute(value) || /[\r\n\0]/.test(value))
    throw Error("Haunt's AppImage path must be an absolute filename.");
  // Exec is parsed by the desktop-entry specification, not by a shell. Quote
  // its argument and escape literal field codes before desktop-value escaping.
  return escapeValue(
    '"' + value.replace(/[%]/g, "%%").replace(/[\\"`$]/g, "\\$&") + '"',
  );
}

async function installLinuxDesktop({
  appImage = process.env.APPIMAGE,
  dataHome = process.env.XDG_DATA_HOME ||
    path.join(os.homedir(), ".local/share"),
  iconPath,
  packageFormat,
  nativeExecutable,
}) {
  // Development/unpacked executables are not AppImage installations.
  if (!appImage && packageFormat !== "rpm") return;
  if (!path.isAbsolute(dataHome) || /[\r\n\0]/.test(dataHome))
    throw Error("XDG_DATA_HOME must be an absolute directory.");
  const exec = executable(appImage || nativeExecutable);
  const file = path.join(dataHome, "applications", desktopName);
  const icon = path.join(dataHome, "icons", `${appId}.png`);
  let previous;
  try {
    previous = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (packageFormat === "rpm" && previous === undefined)
    return {
      file: path.join("/usr/share/applications", desktopName),
      managed: false,
    };
  if (previous !== undefined && !previous.split(/\r?\n/).includes(managed)) {
    if (!previous.split(/\r?\n/).includes(`StartupWMClass=${appId}`))
      throw Error(
        `The existing ${desktopName} launcher has a different application identity.`,
      );
    return { file, managed: false };
  }
  const entry = `[Desktop Entry]\nType=Application\nName=Haunt\nComment=Community messaging and calls\nExec=${exec} %U\nIcon=${escapeValue(icon)}\nTerminal=false\nCategories=Network;\nStartupWMClass=${appId}\n${managed}\n`;
  await fs.mkdir(path.dirname(icon), { recursive: true });
  await fs.copyFile(iconPath, icon);
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (previous === undefined)
    await fs.writeFile(file, entry, { flag: "wx", mode: 0o644 });
  else if (previous !== entry) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(temporary, entry, { flag: "wx", mode: 0o644 });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
  return { file, icon, managed: true };
}
module.exports = { installLinuxDesktop, desktopName };

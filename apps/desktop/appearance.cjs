const os = require("node:os");
function validAppearance(value) {
  if (
    !value ||
    !["solid", "material", "transparent"].includes(value.mode) ||
    typeof value.background !== "string" ||
    !/^#[0-9a-f]{6}$/i.test(value.background) ||
    typeof value.dark !== "boolean"
  )
    throw Error("Invalid window appearance");
  return {
    mode: value.mode,
    background: value.background.toLowerCase(),
    dark: value.dark,
  };
}
function supportedMode(
  mode,
  platform = process.platform,
  release = os.release(),
) {
  if (mode !== "material") return mode;
  if (platform === "darwin") return mode;
  if (platform === "win32" && Number(release.split(".")[2]) >= 22621)
    return mode;
  return "solid";
}
function windowOptions(
  value,
  platform = process.platform,
  release = os.release(),
) {
  const mode = supportedMode(value.mode, platform, release);
  return {
    transparent:
      mode === "transparent" || (mode === "material" && platform === "darwin"),
    backgroundColor: mode === "solid" ? value.background : "#00000000",
    ...(platform === "win32"
      ? { backgroundMaterial: mode === "material" ? "mica" : "none" }
      : {}),
    ...(platform === "darwin" && mode === "material"
      ? { vibrancy: "under-window", visualEffectState: "active" }
      : {}),
  };
}
function applyWindow(
  win,
  value,
  createdTransparent,
  platform = process.platform,
  release = os.release(),
) {
  const requested = supportedMode(value.mode, platform, release);
  const options = windowOptions(value, platform, release);
  if (options.transparent !== createdTransparent)
    return { restart: true, supported: requested === value.mode };
  if (platform === "darwin")
    win.setVibrancy(requested === "material" ? "under-window" : null);
  if (platform === "win32" && Number(release.split(".")[2]) >= 22621)
    win.setBackgroundMaterial(requested === "material" ? "mica" : "none");
  win.setBackgroundColor(options.backgroundColor);
  return {
    effect: requested,
    restart: false,
    supported: requested === value.mode,
  };
}
module.exports = { validAppearance, supportedMode, windowOptions, applyWindow };

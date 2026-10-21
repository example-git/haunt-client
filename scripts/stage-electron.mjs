import { desktopFiles } from "./desktop-files.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runtimeConfig } from "./update-runtime.mjs";
import { buildNotificationReplacement } from "./build-notification-replacement.mjs";
import "./check-native-media.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(root, "electron-app");
const pkg = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
await fs.access(path.join(root, "dist/index.html"));
await fs.access(path.join(root, "dist/THIRD-PARTY-NOTICES.txt"));
await buildNotificationReplacement();
// Only replace generated files in this project's dedicated packaging directory.
for (const name of ["dist", "apps", "resources"])
  await fs.rm(path.join(app, name), { recursive: true, force: true });
await fs.cp(path.join(root, "dist"), path.join(app, "dist"), {
  recursive: true,
});
await fs.mkdir(path.join(app, "apps/desktop"), { recursive: true });
for (const name of desktopFiles)
  await fs.copyFile(
    path.join(root, "apps/desktop", name),
    path.join(app, "apps/desktop", name),
  );
await fs.mkdir(path.join(app, "resources"), { recursive: true });
await fs.copyFile(
  path.join(root, "static/icon.png"),
  path.join(app, "resources/icon.png"),
);
const manifestPath = path.join(app, "package.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.version = pkg.version;
manifest.productName = pkg.productName;
manifest.homepage = pkg.homepage;
manifest.desktopName = pkg.desktopName;
manifest.desktopAppId = JSON.parse(
  await fs.readFile(path.join(root, "electron-builder.config.json"), "utf8"),
).appId;
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
await fs.writeFile(
  path.join(app, "update-runtime.json"),
  JSON.stringify(
    await runtimeConfig(
      process.platform,
      process.env.HAUNT_DESKTOP_ARCH || process.arch,
    ),
    null,
    2,
  ) + "\n",
);
console.log(
  `Staged ${manifest.name} ${manifest.version} in electron-app/ (built UI and Electron shell only).`,
);

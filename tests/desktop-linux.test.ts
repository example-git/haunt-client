import { afterEach, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const { installLinuxDesktop, desktopName } = createRequire(import.meta.url)(
  "../apps/desktop/linux-desktop.cjs",
);
const scratch: string[] = [];
afterEach(async () => {
  for (const directory of scratch.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-launcher-"));
  scratch.push(root);
  const iconPath = path.join(root, "icon.png");
  await fs.writeFile(iconPath, "fixture icon bytes");
  return { root, iconPath, dataHome: path.join(root, "data") };
}
it("installs matching launcher identity and persistent artwork; updates a managed AppImage path", async () => {
  const f = await fixture();
  const appImage = path.join(f.root, 'Haunt $file` "50%".AppImage');
  const result = await installLinuxDesktop({ ...f, appImage });
  expect(path.basename(result.file)).toBe(desktopName);
  const entry = await fs.readFile(result.file, "utf8");
  expect(entry).toContain("StartupWMClass=com.exampleuser.haunt\n");
  expect(entry).toContain("X-GNOME-UsesNotifications=true\n");
  expect(entry).toContain("X-Haunt-Managed=true\n");
  expect(entry).toContain('\\\\$file\\\\` \\\\"50%%\\\\"');
  expect(await fs.readFile(result.icon, "utf8")).toBe("fixture icon bytes");
  await installLinuxDesktop({
    ...f,
    appImage: path.join(f.root, "new.AppImage"),
  });
  expect(await fs.readFile(result.file, "utf8")).toContain('new.AppImage" %U');
});
it("preserves an existing custom launcher with the correct identity and rejects a conflicting identity", async () => {
  const f = await fixture();
  const file = path.join(f.dataHome, "applications", desktopName);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const entry =
    "[Desktop Entry]\nStartupWMClass=com.exampleuser.haunt\nExec=/custom/wrapper\n";
  await fs.writeFile(file, entry);
  expect(
    (await installLinuxDesktop({ ...f, appImage: "/apps/Haunt.AppImage" }))
      .managed,
  ).toBe(false);
  expect(await fs.readFile(file, "utf8")).toBe(entry);
  await fs.writeFile(file, "[Desktop Entry]\nStartupWMClass=other\n");
  await expect(
    installLinuxDesktop({ ...f, appImage: "/apps/Haunt.AppImage" }),
  ).rejects.toThrow("different application identity");
});
it("rejects invalid explicit paths without writing launcher data", async () => {
  const f = await fixture();
  for (const appImage of ["relative.AppImage", "/apps/Haunt\nExec=bad"])
    await expect(installLinuxDesktop({ ...f, appImage })).rejects.toThrow(
      "absolute filename",
    );
  await expect(
    installLinuxDesktop({
      ...f,
      dataHome: "relative",
      appImage: "/apps/Haunt.AppImage",
    }),
  ).rejects.toThrow("XDG_DATA_HOME");
  await expect(fs.access(f.dataHome)).rejects.toThrow();
});

it("uses the RPM system launcher and repoints only Haunt-managed AppImage shortcuts", async () => {
  const f = await fixture();
  const rpm = {
    ...f,
    packageFormat: "rpm",
    nativeExecutable: "/opt/Haunt/haunt",
  };
  expect((await installLinuxDesktop(rpm)).file).toBe(
    "/usr/share/applications/" + desktopName,
  );
  await expect(fs.access(f.dataHome)).rejects.toThrow();
  const previous = await installLinuxDesktop({
    ...f,
    appImage: "/downloads/Haunt.AppImage",
  });
  await installLinuxDesktop(rpm);
  expect(await fs.readFile(previous.file, "utf8")).toContain(
    'Exec="/opt/Haunt/haunt" %U',
  );
  expect(await fs.readFile(previous.file, "utf8")).not.toContain(".AppImage");
});

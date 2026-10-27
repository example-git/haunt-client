import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { manifests, validateVersion, writeVersions } from "../version-main.mjs";

test("explicit release versions accept stable and dev builds and reject invalid values", () => {
  for (const version of ["0.17.9", "1.0.0", "0.17.9-dev.42"])
    assert.equal(validateVersion(version), version);
  for (const version of [
    undefined,
    "",
    "01.2.3",
    "1.2",
    "1.2.3-dev.0",
    "1.2.3-rc.1",
    "1.2.3-dev.1/evil",
  ])
    assert.throws(() => validateVersion(version));
});
test("stamping synchronizes all manifests without changing dependency versions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-version-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const name of manifests) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(
      file,
      JSON.stringify({
        version: "0.17.8",
        dependencies: { unchanged: "1.0.0" },
        ...(name === "package-lock.json"
          ? {
              packages: {
                "": { version: "0.17.8" },
                "packages/core": { version: "0.17.8" },
                "node_modules/unchanged": { version: "1.0.0" },
              },
            }
          : {}),
      }),
    );
  }
  for (const version of ["0.17.9-dev.42", "0.17.9"]) {
    await writeVersions(root, version);
    for (const name of manifests) {
      const value = JSON.parse(await fs.readFile(path.join(root, name)));
      assert.equal(value.version, version);
      assert.equal(value.dependencies.unchanged, "1.0.0");
      if (name === "package-lock.json") {
        assert.equal(value.packages[""].version, version);
        assert.equal(value.packages["packages/core"].version, version);
        assert.equal(value.packages["node_modules/unchanged"].version, "1.0.0");
      }
    }
  }
});

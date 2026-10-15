import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  changedSource,
  chooseBump,
  increment,
  manifests,
  planVersion,
  publishVersion,
} from "../version-main.mjs";

const policy = JSON.parse(
  await fs.readFile(
    new URL("../../version-policy.json", import.meta.url),
    "utf8",
  ),
);
function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
async function write(cwd, name, value) {
  const target = path.join(cwd, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
}
function commit(cwd, message) {
  git(cwd, "add", ".");
  git(
    cwd,
    "-c",
    "user.name=Version test",
    "-c",
    "user.email=version@example.test",
    "commit",
    "-m",
    message,
  );
  git(cwd, "push", "origin", "HEAD:main");
  return git(cwd, "rev-parse", "HEAD");
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-version-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const remote = path.join(root, "remote.git"),
    cwd = path.join(root, "writer");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "clone", remote, cwd);
  for (const name of manifests.filter((name) => name !== "package-lock.json"))
    await write(cwd, name, {
      name: "test",
      version: "0.1.0",
      dependencies: { dependency: "0.1.0" },
    });
  await write(cwd, "package-lock.json", {
    name: "test",
    version: "0.1.0",
    lockfileVersion: 3,
    packages: {
      "": { name: "test", version: "0.1.0" },
      "packages/core": { name: "test", version: "0.1.0" },
      "node_modules/dependency": { version: "0.1.0", integrity: "untouched" },
    },
  });
  await write(cwd, "version-policy.json", policy);
  await write(cwd, "apps/web/src/example.ts", "export const value = 1;\n");
  const before = commit(cwd, "Initial fixture");
  const read = (name) => JSON.parse(git(remote, "show", `main:${name}`));
  return { root, remote, cwd, before, read };
}
function versions(f, expected) {
  for (const name of manifests) assert.equal(f.read(name).version, expected);
  assert.equal(f.read("package-lock.json").packages[""].version, expected);
  assert.equal(
    f.read("package-lock.json").packages["packages/core"].version,
    expected,
  );
  assert.equal(
    f.read("package-lock.json").packages["node_modules/dependency"].version,
    "0.1.0",
  );
  assert.equal(f.read("package.json").dependencies.dependency, "0.1.0");
}

test("size heuristics cover the exact line and file boundaries", () => {
  for (const [stats, expected] of [
    [{ lines: 0, files: 0 }, "patch"],
    [{ lines: 249, files: 7 }, "patch"],
    [{ lines: 250, files: 1 }, "minor"],
    [{ lines: 1, files: 8 }, "minor"],
    [{ lines: 1999, files: 39 }, "minor"],
    [{ lines: 2000, files: 1 }, "major"],
    [{ lines: 1, files: 40 }, "major"],
  ])
    assert.equal(
      chooseBump(["Unspecified update"], stats, policy).bump,
      expected,
    );
});
test("explicit requests win over size and conventional commit hints", () => {
  const large = { lines: 9000, files: 99 };
  assert.equal(
    chooseBump(["feat!: Rework\n\nVersion-Bump: patch"], large, policy).bump,
    "patch",
  );
  assert.equal(
    chooseBump(
      ["Update\n\nVersion-Bump: minor", "Update\n\nVersion-Bump: major"],
      large,
      policy,
    ).bump,
    "major",
  );
  assert.equal(
    chooseBump(["fix(media): Fix playback"], large, policy).bump,
    "patch",
  );
  assert.equal(
    chooseBump(
      ["feat(chat): Add feature", "fix: Repair"],
      { lines: 1, files: 1 },
      policy,
    ).bump,
    "minor",
  );
  assert.equal(
    chooseBump(["refactor!: Replace interface"], { lines: 1, files: 1 }, policy)
      .bump,
    "major",
  );
  assert.equal(
    chooseBump(
      ["Update\n\nBREAKING CHANGE: old interface removed"],
      { lines: 1, files: 1 },
      policy,
    ).bump,
    "major",
  );
});
test("source statistics exclude generated files, tests, assets and pure renames", () => {
  const stats = changedSource(
    [
      "12\t8\tapps/web/src/one.tsx",
      "3\t1\tapps/web/src/has\ttab.css",
      "10000\t10000\tpackage-lock.json",
      "10000\t0\ttests/test.ts",
      "5000\t0\tpackages/core/src/generated/api.ts",
      "4000\t0\tstatic/data.json",
      "2000\t0\tdocs/page.md",
      "-\t-\tapps/image.png",
      "0\t0\t\0apps/old.ts\0apps/new.ts",
      "4\t2\t\0apps/previous.ts\0apps/next.ts",
    ].join("\0") + "\0",
    policy,
  );
  assert.deepEqual(stats, { lines: 30, files: 3 });
});
test("semver arithmetic resets lower components and rejects malformed versions", () => {
  assert.equal(increment("0.2.9", "patch"), "0.2.10");
  assert.equal(increment("0.2.9", "minor"), "0.3.0");
  assert.equal(increment("0.2.9", "major"), "1.0.0");
  for (const bad of ["01.2.3", "0.2.3-beta", "x", "1.2.9007199254740992"])
    assert.throws(() => increment(bad, "patch"));
});
test("a real multi-commit push synchronizes manifests once without touching its checkout", async (t) => {
  const f = await fixture(t);
  await write(
    f.cwd,
    "apps/web/src/feature.ts",
    "export const feature = true;\n",
  );
  commit(f.cwd, "feat: Add feature");
  await write(f.cwd, "apps/web/src/fix.ts", "export const fixed = true;\n");
  const after = commit(f.cwd, "fix: Repair feature");
  const result = await publishVersion({ ...f, after });
  assert.equal(result.version, "0.2.0");
  versions(f, "0.2.0");
  assert.equal(git(f.cwd, "rev-parse", "HEAD"), after);
  assert.equal(git(f.cwd, "status", "--porcelain"), "");
  assert.equal(
    (await publishVersion({ ...f, after })).skipped,
    "Already versioned",
  );
  versions(f, "0.2.0");
});
test("unlabelled push size is measured from git, not commit count", async (t) => {
  const f = await fixture(t);
  await write(
    f.cwd,
    "apps/web/src/large.ts",
    "export const lines = [\n" + "  1,\n".repeat(250) + "];\n",
  );
  const after = commit(f.cwd, "Implement a larger change");
  const plan = await planVersion(f.cwd, f.before, after);
  assert.equal(plan.bump, "minor");
  assert.equal(plan.lines, 252);
  assert.equal((await publishVersion({ ...f, after })).version, "0.2.0");
});
test("manual version increases are synchronized without an extra bump", async (t) => {
  const f = await fixture(t);
  await write(f.cwd, "package.json", {
    ...f.read("package.json"),
    version: "0.6.0",
  });
  const after = commit(f.cwd, "Set release version");
  assert.equal((await publishVersion({ ...f, after })).version, "0.6.0");
  versions(f, "0.6.0");
});
test("a competing push is retained when the version commit retries", async (t) => {
  const f = await fixture(t);
  await write(f.cwd, "apps/web/src/first.ts", "export const first = true;\n");
  const after = commit(f.cwd, "First update");
  const other = path.join(f.root, "other");
  git(f.root, "clone", f.remote, other);
  let competing;
  const result = await publishVersion({
    ...f,
    after,
    beforePush: async (attempt) => {
      if (attempt) return;
      await write(
        other,
        "apps/web/src/second.ts",
        "export const second = true;\n",
      );
      competing = commit(other, "Second update");
    },
  });
  assert.equal(result.version, "0.1.1");
  assert.equal(git(f.remote, "rev-parse", "main^"), competing);
  assert.match(
    git(f.remote, "show", "main:apps/web/src/second.ts"),
    /second = true/,
  );
  // The second push still receives its own bump, even with an intervening bot commit.
  assert.equal(
    (await publishVersion({ ...f, before: after, after: competing })).version,
    "0.1.2",
  );
  versions(f, "0.1.2");
});
test("simultaneous reruns of the same push do not double-increment", async (t) => {
  const f = await fixture(t);
  await write(f.cwd, "apps/web/src/first.ts", "export const first = true;\n");
  const after = commit(f.cwd, "Small update");
  const other = path.join(f.root, "other");
  git(f.root, "clone", f.remote, other);
  const result = await publishVersion({
    ...f,
    after,
    beforePush: async (attempt) => {
      if (!attempt)
        await publishVersion({ cwd: other, before: f.before, after });
    },
  });
  // Identical commits made in the same second can produce the same SHA: that
  // is an already-up-to-date push rather than a rejected competing push.
  assert(result.skipped === "Already versioned" || result.version === "0.1.1");
  versions(f, "0.1.1");
  assert.equal(
    git(
      f.remote,
      "log",
      "main",
      "--format=%H",
      "--grep=Haunt-Versioned-Push:",
    ).split("\n").length,
    1,
  );
});
test("an accidentally copied older package version cannot roll updates backwards", async (t) => {
  const f = await fixture(t);
  await write(f.cwd, "package.json", {
    ...f.read("package.json"),
    version: "0.0.1",
  });
  const after = commit(f.cwd, "Copy a manifest");
  assert.equal((await publishVersion({ ...f, after })).version, "0.1.1");
  versions(f, "0.1.1");
});

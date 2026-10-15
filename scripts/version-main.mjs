import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rank = { patch: 0, minor: 1, major: 2 };
export const manifests = [
  "package.json",
  "package-lock.json",
  "electron-app/package.json",
  "packages/core/package.json",
];
function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trimEnd();
}
function sha(value) {
  if (!/^[a-f0-9]{40}$/.test(value ?? ""))
    throw Error("Expected a full Git commit SHA");
  return value;
}
function parts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw Error(`Expected a stable X.Y.Z version, received ${version}`);
  const values = version.split(".").map(Number);
  if (!values.every(Number.isSafeInteger)) throw Error("Version is too large");
  return values;
}
export function increment(version, bump) {
  const [major, minor, patch] = parts(version);
  if (!(bump in rank)) throw Error("Unknown version bump");
  const next =
    bump === "major"
      ? [major + 1, 0, 0]
      : bump === "minor"
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1];
  const result = next.join(".");
  parts(result);
  return result;
}
function compare(a, b) {
  const left = parts(a),
    right = parts(b);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
export function changedSource(numstat, policy) {
  let lines = 0,
    files = 0;
  const entries = numstat.split("\0");
  for (let i = 0; i < entries.length; i++) {
    if (!entries[i]) continue;
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(entries[i]);
    if (!match) throw Error("Unexpected git numstat output");
    let name = match[3];
    if (!name) {
      i++;
      name = entries[++i];
    } // -z rename: old path, new path
    if (!name || match[1] === "-" || match[2] === "-") continue;
    if (
      policy.exclude.some(
        (entry) =>
          name === entry || (entry.endsWith("/") && name.startsWith(entry)),
      )
    )
      continue;
    if (
      !/\.(?:[cm]?[jt]sx?|css|scss|html|vue|svelte|go|rs|c|h|cpp|swift|json|ya?ml|toml|sh|ps1)$/i.test(
        name,
      )
    )
      continue;
    const changed = Number(match[1]) + Number(match[2]);
    if (!changed) continue; // A pure rename has no implementation-size increase.
    files++;
    lines += changed;
  }
  return { lines, files };
}
export function chooseBump(messages, stats, policy) {
  const explicit = messages.flatMap((message) =>
    [...message.matchAll(/^Version-Bump:\s*(patch|minor|major)\s*$/gim)].map(
      (m) => m[1].toLowerCase(),
    ),
  );
  const highest = (values) => values.sort((a, b) => rank[b] - rank[a])[0];
  if (explicit.length)
    return { bump: highest(explicit), reason: "Version-Bump override" };
  const conventional = messages.flatMap((message) => {
    const subject = message.split("\n")[0];
    if (
      /^[a-z]+(?:\([^\n)]+\))?!: /i.test(subject) ||
      /^BREAKING[ -]CHANGE:\s*\S/m.test(message)
    )
      return ["major"];
    if (/^feat(?:\([^\n)]+\))?: /i.test(subject)) return ["minor"];
    if (/^(?:fix|perf)(?:\([^\n)]+\))?: /i.test(subject)) return ["patch"];
    return [];
  });
  if (conventional.length)
    return { bump: highest(conventional), reason: "Conventional commit" };
  for (const bump of ["major", "minor"]) {
    const threshold = policy[bump];
    if (
      !Number.isSafeInteger(threshold.lines) ||
      threshold.lines < 1 ||
      !Number.isSafeInteger(threshold.files) ||
      threshold.files < 1
    )
      throw Error("Invalid version-size threshold");
    if (stats.lines >= threshold.lines || stats.files >= threshold.files)
      return { bump, reason: "Source diff size" };
  }
  return { bump: "patch", reason: "Source diff size" };
}
export async function planVersion(cwd, before, after) {
  sha(before);
  sha(after);
  const initial = /^0+$/.test(before);
  const base = initial
    ? git(cwd, "hash-object", "-w", "-t", "tree", "--stdin")
    : before;
  const policy = JSON.parse(
    await fs.readFile(path.join(cwd, "version-policy.json"), "utf8"),
  );
  const stats = changedSource(
    git(cwd, "diff", "--numstat", "-z", "--find-renames", base, after, "--"),
    policy,
  );
  const messages = git(
    cwd,
    "log",
    "--format=%B%x00",
    initial ? after : `${before}..${after}`,
  )
    .split("\0")
    .map((m) => m.trim())
    .filter(Boolean);
  const previous = initial
    ? undefined
    : JSON.parse(git(cwd, "show", `${before}:package.json`)).version;
  const pushed = JSON.parse(git(cwd, "show", `${after}:package.json`)).version;
  parts(pushed);
  const choice = chooseBump(messages, stats, policy);
  return {
    ...choice,
    ...stats,
    previousVersion: previous,
    manualVersion:
      previous && compare(pushed, previous) > 0 ? pushed : undefined,
  };
}
export async function writeVersions(cwd, version) {
  parts(version);
  for (const name of manifests) {
    const filename = path.join(cwd, name);
    const value = JSON.parse(await fs.readFile(filename, "utf8"));
    value.version = version;
    if (name === "package-lock.json") {
      if (!value.packages?.[""] || !value.packages["packages/core"])
        throw Error("Missing workspace lockfile entries");
      value.packages[""].version = version;
      value.packages["packages/core"].version = version;
    }
    await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
  }
}

// Optimistic fast-forward pushes preserve concurrent work. Each run has its own
// worktree; it never resets the checkout or force-pushes over another writer.
export async function publishVersion({
  cwd,
  before,
  after,
  beforePush,
  attempts = 6,
}) {
  const plan = await planVersion(cwd, before, after);
  const marker = `Haunt-Versioned-Push: ${before}:${after}`;
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "haunt-version-"));
  const tree = path.join(scratch, "checkout");
  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      git(cwd, "fetch", "origin", "main");
      const tip = git(cwd, "rev-parse", "origin/main");
      if (
        git(
          cwd,
          "log",
          "origin/main",
          "--format=%H",
          "--fixed-strings",
          `--grep=${marker}`,
          "-1",
        )
      )
        return { ...plan, skipped: "Already versioned" };
      const ancestor = spawnSync(
        "git",
        ["merge-base", "--is-ancestor", after, tip],
        { cwd },
      );
      if (ancestor.status !== 0)
        throw Error(
          "The pushed commit is no longer on main; refusing to version replaced history",
        );
      git(cwd, "worktree", "add", "--detach", tree, tip);
      try {
        const saved = JSON.parse(
          await fs.readFile(path.join(tree, "package.json"), "utf8"),
        ).version;
        // A copied older manifest must not roll the automatic version backwards.
        const current =
          plan.previousVersion && compare(saved, plan.previousVersion) < 0
            ? plan.previousVersion
            : saved;
        const version = plan.manualVersion
          ? compare(current, plan.manualVersion) >= 0
            ? current
            : plan.manualVersion
          : increment(current, plan.bump);
        await writeVersions(tree, version);
        git(tree, "add", "--", ...manifests);
        git(
          tree,
          "-c",
          "user.name=github-actions[bot]",
          "-c",
          "user.email=41898282+github-actions[bot]@users.noreply.github.com",
          "commit",
          "--allow-empty",
          "-m",
          `chore(release): version ${version}`,
          "-m",
          `${marker}\nVersion-Bump: ${plan.bump}\n${plan.reason}: ${plan.lines} source lines across ${plan.files} files.`,
        );
        await beforePush?.(attempt); // Deterministic competing-writer fixture.
        const pushed = spawnSync(
          "git",
          ["push", "origin", "HEAD:refs/heads/main"],
          { cwd: tree, encoding: "utf8", timeout: 30000 },
        );
        if (pushed.status === 0)
          return { ...plan, version, commit: git(tree, "rev-parse", "HEAD") };
        git(cwd, "fetch", "origin", "main");
        if (git(cwd, "rev-parse", "origin/main") === tip)
          throw Error(
            `Version push failed: ${pushed.stderr || pushed.error || "unknown error"}`,
          );
      } finally {
        git(cwd, "worktree", "remove", "--force", tree);
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    throw Error(
      "Main kept advancing; rerun this job to finish its version bump",
    );
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
}

async function main() {
  const cwd = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
  if (process.argv[2] === "--preview") {
    const before = git(
      cwd,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${process.argv[3] ?? "HEAD~1"}^{commit}`,
    );
    const after = git(
      cwd,
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${process.argv[4] ?? "HEAD"}^{commit}`,
    );
    console.log(JSON.stringify(await planVersion(cwd, before, after), null, 2));
    return;
  }
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REF !== "refs/heads/main"
  )
    throw Error("Automatic version writes run only in GitHub Actions on main");
  const event = JSON.parse(
    await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  if (event.deleted) return;
  const before = process.env.VERSION_BEFORE || event.before;
  const after = process.env.VERSION_AFTER || event.after;
  const result = await publishVersion({ cwd, before, after });
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    await fs.appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `Client version: **${result.version ?? result.skipped}**\n\n${result.bump}: ${result.reason}; ${result.lines} source lines, ${result.files} files.\n`,
    );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

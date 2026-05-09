// lib/install.js
// `hindsight-agent init` and `hindsight-agent uninstall` commands.
//
// init installs a post-commit hook in the user's git repo that points back
// at this package's index.js, wrapped by run-with-node.sh so the hook can
// find a node binary even when fired from a stripped git env (fnm/nvm/etc).

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, chmodSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const HOOK_MARKER = "# hindsight-agent post-commit hook";

function packageRoot() {
  // lib/install.js → ../
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function gitDir() {
  return execSync("git rev-parse --git-dir", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function gitTopLevel() {
  return execSync("git rev-parse --show-toplevel", {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function ensureGitRepo() {
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    console.error("hindsight: not inside a git repository");
    process.exit(1);
  }
}

function probeNode(wrapper) {
  const probe = join(packageRoot(), "scripts", "probe-node.js");
  try {
    return execSync(`"${wrapper}" "${probe}"`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    throw new Error(
      `wrapper at ${wrapper} could not find a node binary. ${err.stderr || err.message}\n` +
        `Set HINDSIGHT_NODE=/path/to/node and re-run.`
    );
  }
}

function appendGitignore(repoRoot) {
  const path = join(repoRoot, ".gitignore");
  const entries = ["reviews.log", "review-cache.json"];
  let current = existsSync(path) ? readFileSync(path, "utf-8") : "";
  const missing = entries.filter((e) => !current.split("\n").includes(e));
  if (missing.length === 0) return false;
  const prefix = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  const block = `${prefix}\n# hindsight-agent\n${missing.join("\n")}\n`;
  writeFileSync(path, current + block);
  return true;
}

export function init() {
  ensureGitRepo();

  const root = packageRoot();
  const wrapper = join(root, "bin", "run-with-node.sh");
  const indexPath = join(root, "index.js");
  const hookPath = join(gitDir(), "hooks", "post-commit");
  const repoRoot = gitTopLevel();

  if (!existsSync(wrapper)) {
    console.error(`hindsight: missing wrapper at ${wrapper}`);
    process.exit(1);
  }

  // Make sure the wrapper is executable (npm sometimes drops the bit).
  try {
    chmodSync(wrapper, 0o755);
  } catch {
    /* best effort */
  }

  let nodePath;
  try {
    nodePath = probeNode(wrapper);
  } catch (err) {
    console.error(`hindsight: ${err.message}`);
    process.exit(1);
  }

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf-8");
    if (existing.includes(HOOK_MARKER)) {
      console.log(`hindsight: post-commit hook already installed at ${hookPath}`);
    } else {
      console.error(
        `hindsight: a non-hindsight post-commit hook already exists at ${hookPath}\n` +
          `Back it up or merge manually, then re-run \`npx hindsight-agent init\`.`
      );
      process.exit(1);
    }
  } else {
    const hook =
      `#!/bin/sh\n` +
      `${HOOK_MARKER}\n` +
      `# Detached so commit returns immediately.\n` +
      `( "${wrapper}" "${indexPath}" >/dev/null 2>&1 & ) &\n`;
    writeFileSync(hookPath, hook);
    chmodSync(hookPath, 0o755);
    console.log(`hindsight: installed post-commit hook at ${hookPath}`);
  }

  const updatedGitignore = appendGitignore(repoRoot);
  if (updatedGitignore) {
    console.log(`hindsight: added reviews.log and review-cache.json to .gitignore`);
  }

  const logPath = join(repoRoot, "reviews.log");

  console.log(`
hindsight: setup complete.
  resolved node:  ${nodePath}
  reviews log:    ${logPath}

To watch reviews land in real time as you commit, run this in a separate terminal:

  tail -f ${logPath}

Optional — surface 'worth_refactoring' reviews back into Claude Code.
Add this to ~/.claude/settings.json (then restart Claude Code):

{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "${wrapper} ${join(root, "surface.js")}" }
        ]
      }
    ]
  }
}
`);
}

export function uninstall() {
  ensureGitRepo();
  const hookPath = join(gitDir(), "hooks", "post-commit");

  if (!existsSync(hookPath)) {
    console.log(`hindsight: no post-commit hook to remove at ${hookPath}`);
  } else {
    const existing = readFileSync(hookPath, "utf-8");
    if (!existing.includes(HOOK_MARKER)) {
      console.error(
        `hindsight: post-commit hook at ${hookPath} was not installed by hindsight.\n` +
          `Refusing to remove it. Delete it manually if you want to.`
      );
      process.exit(1);
    }
    unlinkSync(hookPath);
    console.log(`hindsight: removed post-commit hook at ${hookPath}`);
  }

  console.log(`
If you added the Stop-hook snippet to ~/.claude/settings.json, remove it
manually and restart Claude Code.

Your reviews.log and review-cache.json are kept in this repo. Delete them
if you no longer want them.
`);
}

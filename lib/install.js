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
import { bold, dim, cyan, yellow, check, cross, info, section, box } from "./style.js";

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
    console.error(`${cross()} not inside a git repository`);
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
    console.error(`${cross()} missing wrapper at ${wrapper}`);
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
    console.error(`${cross()} ${err.message}`);
    process.exit(1);
  }

  console.log("");

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, "utf-8");
    if (existing.includes(HOOK_MARKER)) {
      console.log(`${info()} ${bold("Post-commit hook")} already installed`);
      console.log(`  ${dim(hookPath)}`);
    } else {
      console.error(
        `${cross()} ${bold("Post-commit hook conflict")}\n` +
          `  A non-hindsight hook already exists at:\n` +
          `  ${dim(hookPath)}\n\n` +
          `  Back it up or merge manually, then re-run ${cyan("npx hindsight-agent init")}.`
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
    console.log(`${check()} ${bold("Post-commit hook installed")}`);
    console.log(`  ${dim(hookPath)}`);
  }

  if (appendGitignore(repoRoot)) {
    console.log(`${check()} ${bold(".gitignore")} updated ${dim("(reviews.log, review-cache.json)")}`);
  } else {
    console.log(`${info()} ${bold(".gitignore")} already covers reviews.log and review-cache.json`);
  }

  const logPath = join(repoRoot, "reviews.log");
  const surfaceCmd = `${wrapper} ${join(root, "surface.js")}`;
  const stopHookSnippet = JSON.stringify(
    {
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [{ type: "command", command: surfaceCmd }],
          },
        ],
      },
    },
    null,
    2
  );

  console.log(section("Tail your reviews"));
  console.log(`  ${cyan(`tail -f ${logPath}`)}`);
  console.log(`\n  ${dim("Run that in a side terminal — every commit streams a review entry.")}`);

  console.log(section("Optional: feedback mode"));
  console.log(
    `  ${dim("Surfaces 'worth_refactoring' reviews back into Claude Code.")}\n` +
      `  ${dim(`Paste this into ${bold("~/.claude/settings.json")}, then restart Claude Code:`)}\n`
  );
  console.log(box(stopHookSnippet));

  console.log(`\n${dim(`Resolved node: ${nodePath}`)}\n`);
}

export function uninstall() {
  ensureGitRepo();
  const hookPath = join(gitDir(), "hooks", "post-commit");

  console.log("");

  if (!existsSync(hookPath)) {
    console.log(`${info()} ${bold("No post-commit hook")} to remove`);
    console.log(`  ${dim(hookPath)}`);
  } else {
    const existing = readFileSync(hookPath, "utf-8");
    if (!existing.includes(HOOK_MARKER)) {
      console.error(
        `${cross()} ${bold("Refusing to remove unknown hook")}\n` +
          `  The post-commit hook at ${dim(hookPath)}\n` +
          `  was not installed by hindsight. Delete it manually if you want.`
      );
      process.exit(1);
    }
    unlinkSync(hookPath);
    console.log(`${check()} ${bold("Removed post-commit hook")}`);
    console.log(`  ${dim(hookPath)}`);
  }

  console.log(
    `\n${yellow("!")} If you added the Stop-hook snippet to ${bold("~/.claude/settings.json")},\n` +
      `  remove it manually and restart Claude Code.\n\n` +
      `${dim("reviews.log and review-cache.json are kept in this repo. Delete them yourself if you no longer want them.")}\n`
  );
}

#!/bin/sh
# scripts/install-hook.sh
# Installs the hindsight post-commit hook into the current git repo.
# Detaches the agent so commits feel instant.
#
# Both the post-commit hook and the printed Stop-hook snippet invoke
# bin/run-with-node.sh, which resolves a usable node binary at hook-fire
# time — handles fnm/nvm/volta/asdf/mise/homebrew/system without baking
# in a path that might break when the user upgrades or switches managers.

set -e

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: not inside a git repository" >&2
  exit 1
fi

HINDSIGHT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_PATH="$(git rev-parse --git-dir)/hooks/post-commit"
WRAPPER="$HINDSIGHT_DIR/bin/run-with-node.sh"

if [ ! -x "$WRAPPER" ]; then
  echo "Error: missing or non-executable wrapper at $WRAPPER" >&2
  exit 1
fi

# Sanity-check that the wrapper can find a node binary right now, so the
# user gets a clear error here rather than a silent hook failure later.
if ! NODE_PROBE="$("$WRAPPER" "$HINDSIGHT_DIR/scripts/probe-node.js" 2>&1)"; then
  echo "Error: $WRAPPER could not find a node binary." >&2
  echo "$NODE_PROBE" >&2
  echo "Set HINDSIGHT_NODE=/path/to/node and re-run." >&2
  exit 1
fi

if [ -e "$HOOK_PATH" ]; then
  echo "Existing post-commit hook found at $HOOK_PATH"
  echo "Back it up or merge manually. Aborting."
  exit 1
fi

cat > "$HOOK_PATH" <<EOF
#!/bin/sh
# hindsight-agent post-commit hook
# Detached so commit returns immediately.
( "$WRAPPER" "$HINDSIGHT_DIR/index.js" >/dev/null 2>&1 & ) &
EOF

chmod +x "$HOOK_PATH"
echo "Installed post-commit hook: $HOOK_PATH"
echo "Resolved node via wrapper: $NODE_PROBE"
echo "Reviews will append to: $HINDSIGHT_DIR/reviews.log"
echo
echo "To enable feedback mode (surface 'worth_refactoring' reviews back into Claude Code),"
echo "add this to ~/.claude/settings.json:"
echo
cat <<EOF
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "$WRAPPER $HINDSIGHT_DIR/surface.js" }
        ]
      }
    ]
  }
}
EOF
echo
echo "Then restart Claude Code."

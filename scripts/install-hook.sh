#!/bin/sh
# scripts/install-hook.sh
# Installs the hindsight post-commit hook into the current git repo.
# Detaches the agent so commits feel instant.

set -e

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "Error: not inside a git repository" >&2
  exit 1
fi

HINDSIGHT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_PATH="$(git rev-parse --git-dir)/hooks/post-commit"
NODE_BIN="${HINDSIGHT_NODE:-$(command -v node)}"

if [ -z "$NODE_BIN" ]; then
  echo "Error: node not found. Set HINDSIGHT_NODE=/path/to/node and re-run." >&2
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
( "$NODE_BIN" "$HINDSIGHT_DIR/index.js" >/dev/null 2>&1 & ) &
EOF

chmod +x "$HOOK_PATH"
echo "Installed: $HOOK_PATH"
echo "Reviews will append to: $HINDSIGHT_DIR/reviews.log"

# ----------------------------------------------------------------------------
# Optional: feedback mode (DISABLED by default).
# Uncomment the block below AND set HINDSIGHT_FEEDBACK_MODE=on in your shell
# profile when you're ready to have unread "worth_refactoring" reviews
# surfaced back into Claude Code automatically.
#
# Add to your Claude Code settings.json (~/.claude/settings.json):
#
# {
#   "hooks": {
#     "Stop": [
#       {
#         "matcher": "",
#         "hooks": [
#           {
#             "type": "command",
#             "command": "node /absolute/path/to/hindsight-agent/surface.js"
#           }
#         ]
#       }
#     ]
#   }
# }
#
# Then in your shell profile:
#   export HINDSIGHT_FEEDBACK_MODE=on
# ----------------------------------------------------------------------------

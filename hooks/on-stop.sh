#!/usr/bin/env bash
# Stop hook. Surfaces an unread `worth_refactoring` review for the current HEAD
# back to the Claude Code session via stderr + exit 2.
#
# Engine is bundled in the plugin's dist/ directory.

set -euo pipefail

exec node "${CLAUDE_PLUGIN_ROOT}/dist/surface.js"

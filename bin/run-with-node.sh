#!/bin/sh
# bin/run-with-node.sh
# Resolve a usable node binary and exec the given JS script with the rest of the args.
#
# Used by the post-commit hook and the Claude Code Stop hook so installs work
# regardless of which version manager (fnm, nvm, volta, asdf, mise) or system
# install (homebrew, /usr/bin) the user has — and so config keeps working when
# they upgrade or switch managers later.
#
# Override with HINDSIGHT_NODE=/path/to/node if the auto-resolver picks wrong.

set -e

if [ -z "$1" ]; then
  echo "usage: $0 <script.js> [args...]" >&2
  exit 2
fi

SCRIPT="$1"
shift

resolve_node() {
  # 1. Already on PATH — but skip fnm's per-shell shims, they vanish between sessions
  NODE="$(command -v node 2>/dev/null || true)"
  if [ -n "$NODE" ]; then
    case "$NODE" in
      *fnm_multishells*) ;;
      *) printf '%s\n' "$NODE"; return 0 ;;
    esac
  fi

  # 2. fnm's stable default-alias path
  if [ -x "$HOME/.local/share/fnm/aliases/default/bin/node" ]; then
    printf '%s\n' "$HOME/.local/share/fnm/aliases/default/bin/node"
    return 0
  fi

  # 3. fnm binary present — eval its env to bring node onto PATH
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env 2>/dev/null)" || true
    NODE="$(command -v node 2>/dev/null || true)"
    if [ -n "$NODE" ]; then
      printf '%s\n' "$NODE"
      return 0
    fi
  fi

  # 4. volta
  if [ -x "$HOME/.volta/bin/node" ]; then
    printf '%s\n' "$HOME/.volta/bin/node"
    return 0
  fi

  # 5. asdf shims
  if [ -x "$HOME/.asdf/shims/node" ]; then
    printf '%s\n' "$HOME/.asdf/shims/node"
    return 0
  fi

  # 6. mise shims
  if [ -x "$HOME/.local/share/mise/shims/node" ]; then
    printf '%s\n' "$HOME/.local/share/mise/shims/node"
    return 0
  fi

  # 7. nvm — newest installed version (no shims, has to walk versions/)
  if [ -d "$HOME/.nvm/versions/node" ]; then
    NVM_LATEST="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -1)"
    if [ -n "$NVM_LATEST" ] && [ -x "$HOME/.nvm/versions/node/$NVM_LATEST/bin/node" ]; then
      printf '%s\n' "$HOME/.nvm/versions/node/$NVM_LATEST/bin/node"
      return 0
    fi
  fi

  # 8. Homebrew
  for p in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "$p" ]; then
      printf '%s\n' "$p"
      return 0
    fi
  done

  # 9. System
  if [ -x "/usr/bin/node" ]; then
    printf '%s\n' "/usr/bin/node"
    return 0
  fi

  return 1
}

if [ -n "$HINDSIGHT_NODE" ]; then
  NODE="$HINDSIGHT_NODE"
elif ! NODE="$(resolve_node)"; then
  echo "hindsight: could not find a node binary." >&2
  echo "hindsight: set HINDSIGHT_NODE=/path/to/node to override." >&2
  exit 1
fi

exec "$NODE" "$SCRIPT" "$@"

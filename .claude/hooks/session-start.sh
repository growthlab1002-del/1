#!/bin/bash
# Installs project dependencies at the start of Claude Code cloud sessions.
# Each block runs only if the matching manifest exists, so it is safe to keep
# as the project grows.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Node.js
if [ -f package.json ]; then
  if [ -f pnpm-lock.yaml ]; then
    corepack enable >/dev/null 2>&1 || true
    pnpm install
  elif [ -f yarn.lock ]; then
    corepack enable >/dev/null 2>&1 || true
    yarn install
  else
    npm install
  fi
fi

# Python
if [ -f requirements.txt ]; then
  pip install -r requirements.txt
fi
if [ -f pyproject.toml ]; then
  pip install -e .
fi

# Go
if [ -f go.mod ]; then
  go mod download
fi

# Rust
if [ -f Cargo.toml ]; then
  cargo fetch
fi

# Ruby
if [ -f Gemfile ]; then
  bundle install
fi

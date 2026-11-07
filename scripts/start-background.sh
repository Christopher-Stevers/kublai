#!/bin/bash
set -euo pipefail
repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
export FOREMANHQ_WORKER_BUNDLE
FOREMANHQ_WORKER_BUNDLE=$(realpath "$repo_root/.background/current")
export FOREMANHQ_APP_ROOT="$repo_root"
export FOREMANHQ_PROCESS_ROLE=worker
export FOREMANHQ_BACKGROUND_MODE=separate
export NODE_ENV=production
export NEXT_PUBLIC_APP_RELEASE
NEXT_PUBLIC_APP_RELEASE=$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).commit)' "$FOREMANHQ_WORKER_BUNDLE/release.json")
exec node --conditions=react-server --max-old-space-size=1536 --import dotenv/config "$FOREMANHQ_WORKER_BUNDLE/server/background/worker.mjs" "$@"

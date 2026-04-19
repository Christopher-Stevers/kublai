#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

export NODE_ENV=production
export PATH="$PWD/node_modules/.bin:$PATH"
exec "$@"

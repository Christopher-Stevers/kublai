#!/usr/bin/env bash
set -euo pipefail
cleanup(){ kill -TERM 4030375 2>/dev/null || true; }
trap cleanup EXIT INT TERM
timeout --signal=TERM --kill-after=10s 150s node /tmp/foremanhq-material-cpu-a3-v3-method/perf/material-list-cpu-diagnostic.mjs /tmp/foremanhq-material-cpu-a3-v3-config.json

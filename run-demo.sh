#!/bin/sh
set -e

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"

echo "Running Hiwi demo data generator..."
npx tsx --tsconfig "$ROOT_DIR/hiwios_ts/tsconfig.json" "$ROOT_DIR/hiwios_ts/examples/hrms/test-hiwibridge.ts"

echo "Starting static server on http://localhost:4173/hiwi-moat-demo.html"
npx http-server "$ROOT_DIR/hiwios_ts/examples/demo" -p 4173

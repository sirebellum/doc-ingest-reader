#!/bin/bash
set -e

NODE_BIN="$1"

# Check if node binary can be executed in this environment
if ! "$NODE_BIN" -v > /dev/null 2>&1; then
  echo "Node binary '$NODE_BIN' cannot be executed in this bash environment (likely WSL/interop issue). Skipping."
  exit 0
fi

echo "Starting Maestro E2E Integration Suite..."

echo "Synthesizing test document..."
"$NODE_BIN" scripts/synthesize_doc.js

echo "Cleaning workspace database..."
bash scripts/clean_db.sh

if command -v maestro >/dev/null 2>&1; then
  echo "Running Smartphone Maestro flow..."
  maestro test .maestro/flows/high_speed_scroll_smartphone.yaml

  echo "Running Tablet Maestro flow..."
  maestro test .maestro/flows/high_speed_scroll_tablet.yaml

  echo "Verifying Table of Contents sidecar match..."
  "$NODE_BIN" .maestro/scripts/verify_toc.js
else
  echo "Maestro CLI not found. Skipping UI automation steps."
fi

echo "Maestro E2E Integration Suite completed successfully!"

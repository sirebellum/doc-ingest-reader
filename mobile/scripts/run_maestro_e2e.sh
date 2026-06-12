#!/bin/bash
set -e
if command -v cygpath >/dev/null 2>&1 && [ -n "$1" ]; then
  NODE_BIN="$(cygpath -u "$1")"
else
  NODE_BIN="${1:-node}"
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

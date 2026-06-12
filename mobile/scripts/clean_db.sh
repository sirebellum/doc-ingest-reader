#!/bin/bash

# clean_db.sh
# A wrapper script to clean the active SQLite database and app sandbox folders.
# It can be used manually to reset the local environment or triggered as part of test setups.

echo "Cleaning database and sandbox folders..."

# Define the package name used by Expo dev client / standalone
PACKAGE_NAME="host.exp.exponent"

# Try to clear Android state if adb is available
if command -v adb &> /dev/null; then
    echo "Clearing Android App State for $PACKAGE_NAME..."
    adb shell pm clear $PACKAGE_NAME
    echo "Android state cleared."
else
    echo "adb not found, skipping Android clear."
fi

# Try to clear iOS state if xcrun is available
if command -v xcrun &> /dev/null; then
    echo "Clearing iOS Simulator App Data..."
    # Note: erasing all booted simulators.
    xcrun simctl erase booted
    echo "iOS state cleared."
else
    echo "xcrun not found, skipping iOS clear."
fi

echo "Clean up complete. The workspace is isolated and ready for the next test loop."

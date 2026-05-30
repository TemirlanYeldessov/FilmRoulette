#!/usr/bin/env bash
set -euo pipefail

# This Expo-managed app calls Gemini from JavaScript via fetch. There is no
# native Gemini SDK or React Native bridge to inject into generated Gradle files.
# Keep the CI hook as a small cleanup guard for stale generated Android files.

if [ ! -d android ]; then
  echo "No android directory found; nothing to patch."
  exit 0
fi

legacy_provider_pattern='[gG][rR][oO][qQ]'
matches="$(grep -RIl "$legacy_provider_pattern" android || true)"

if [ -z "$matches" ]; then
  echo "No legacy AI provider references found in generated Android files."
  exit 0
fi

while IFS= read -r file; do
  sed -i "/$legacy_provider_pattern/d" "$file"
done <<< "$matches"

echo "Removed legacy AI provider references from generated Android files."

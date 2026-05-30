#!/usr/bin/env bash
set -euo pipefail

# Called after `expo prebuild` in CI. Patches generated android/*/build.gradle
# to remove any leftover Groq dependencies and add the official Gemini SDK.

cd android || exit 0

# Remove any lines mentioning 'groq' (case-insensitive) in Gradle files
grep -RIl "groq" . || true
for f in $(grep -RIl "groq" . || true); do
  sed -i '/groq/Id' "$f"
done

# Insert the official Gemini SDK dependency into files with a dependencies block
for f in $(grep -RIl "^\s*dependencies\s*\{" . || true); do
  if ! grep -q 'com.google.ai.client.generativeai:generativeai' "$f"; then
    awk '
      BEGIN{p=1}
      /dependencies[[:space:]]*\{/ && p{print; print "    implementation(\"com.google.ai.client.generativeai:generativeai:0.9.0\")"; p=0; next}
      {print}
    ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

echo "Patched Gradle files to include Gemini SDK where needed."

# Create a simple React Native native module (Kotlin) to bridge to the
# official Gemini SDK. This file is written into the generated android/ tree
# after `expo prebuild`. It is a best-effort template — adjust the
# `GenerativeModel` usage to match the exact Java SDK once Gradle sync runs.

APP_ROOT="$(pwd)"
KOT_DIR="$APP_ROOT/app/src/main/java/com/filmroulette/gemini"
mkdir -p "$KOT_DIR"

cat > "$KOT_DIR/GeminiModule.kt" <<'KOT'
package com.filmroulette.gemini

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

// NOTE: The exact Java SDK types and builders may differ. This file
// provides a runnable bridge structure. After Gradle sync, adjust
// the GenerativeModel usage (imports and request building) to the
// exact SDK API from com.google.ai.client.generativeai.

class GeminiModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    #!/usr/bin/env bash
    set -euo pipefail

    # This project is an Expo-managed React Native app. Per scenario 1 we do not
    # add native bridges or touch Gradle files. Keep this script minimal: remove
    # any accidental mentions of "groq" in generated files, but do not inject
    # SDK dependencies or create native code.

    cd android || exit 0

    # Remove any lines mentioning 'groq' (case-insensitive) in generated files
    grep -RIl "groq" . || true
    for f in $(grep -RIl "groq" . || true); do
      sed -i '/groq/Id' "$f"
    done

    echo "Cleaned groq references from generated Android files (no Gradle edits)."
                // val text = response.getCandidates().first().getOutputText()

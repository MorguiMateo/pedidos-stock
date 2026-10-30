#!/usr/bin/env bash
set -euo pipefail
set +x
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TOOLS="${PEDIDOS_TOOLS_DIR:-$HOME/.local/share/pedidos-stock-tools}"
export ANDROID_HOME="${ANDROID_HOME:-$TOOLS/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export GRADLE_USER_HOME="${GRADLE_USER_HOME:-$TOOLS/gradle}"
if [[ -z "${JAVA_HOME:-}" && "$(uname -s)" == Darwin ]]; then export JAVA_HOME="$(/usr/libexec/java_home -v 17)"; fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$PATH"
export NODE_ENV=production
node - <<'NODE'
require('@expo/env').load(process.cwd());
if (process.env.PEDIDOS_ALLOW_UNCONFIGURED === '1') process.exit(0);
if (!/^https:\/\//.test(process.env.EXPO_PUBLIC_SUPABASE_URL || '') || !process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env before building the production APK.');
  process.exit(1);
}
NODE
[[ -x "$ANDROID_HOME/cmdline-tools/23.0/bin/sdkmanager" ]] || bash scripts/setup-android.sh
bash scripts/create-signing.sh
# shellcheck disable=SC1090
source "$TOOLS/signing/release.env"
[[ -f "$PEDIDOS_KEYSTORE_FILE" ]] || { echo 'Production keystore is missing.'; exit 1; }
npx expo prebuild --platform android --no-install --no-clean
printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
cd android
# One universal APK includes the Android ABIs; release embeds the Hermes JS bundle.
# Rerun only the JS bundling task: changes to .env must never reuse an older
# embedded backend URL/key. Native compilation remains incremental.
./gradlew :app:createBundleReleaseJsAndAssets --rerun :app:assembleRelease --no-daemon --max-workers="${PEDIDOS_GRADLE_WORKERS:-4}" '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g' -Pandroid.cmakeVersion=3.30.5 -PreactNativeArchitectures=armeabi-v7a,arm64-v8a,x86,x86_64
cd "$ROOT"
mkdir -p artifacts
APP_VERSION="$(node -p 'require("./package.json").version')"
DEST="artifacts/kalak-logistica-$APP_VERSION.apk"
[[ "${PEDIDOS_ALLOW_UNCONFIGURED:-0}" != 1 ]] || DEST=artifacts/kalak-logistica-unconfigured.apk
cp android/app/build/outputs/apk/release/app-release.apk "$DEST"
BUILD_TOOLS="$(node -p 'require("fs").readFileSync("node_modules/react-native/gradle/libs.versions.toml","utf8").match(/^buildTools = "([^"]+)"/m)[1]')"
"$ANDROID_HOME/build-tools/$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$DEST"
unzip -l "$DEST" | rg 'assets/index.android.bundle' >/dev/null || { echo 'Release JS bundle missing from APK.'; exit 1; }
EVIDENCE="artifacts/evidence/release-$APP_VERSION"
mkdir -p "$EVIDENCE"
shasum -a 256 "$DEST" > "$EVIDENCE/$(basename "$DEST").sha256"
printf '\nSigned standalone APK: %s/%s\n' "$ROOT" "$DEST"

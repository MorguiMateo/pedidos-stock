#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${PEDIDOS_TOOLS_DIR:-$HOME/.local/share/pedidos-stock-tools}"
export ANDROID_HOME="${ANDROID_HOME:-$TOOLS/android-sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [[ -z "${JAVA_HOME:-}" && "$(uname -s)" == Darwin ]]; then export JAVA_HOME="$(/usr/libexec/java_home -v 17)"; fi
[[ -n "${JAVA_HOME:-}" ]] || { echo 'Set JAVA_HOME to JDK 17 (or newer supported by Gradle).'; exit 1; }
export PATH="$JAVA_HOME/bin:$PATH"
case "$(uname -s)" in
  Darwin)
    if [[ "$(uname -m)" == arm64 ]]; then
      ARCHIVE=commandlinetools-mac_arm64-16111833_latest.zip; SHA1=ad03dc49bfacfd52c110b14104ea548b8a07e830
    else
      ARCHIVE=commandlinetools-mac_x86_64-16111833_latest.zip; SHA1=112cf9618794a997ff273537d55bee02c22abffe
    fi ;;
  Linux) ARCHIVE=commandlinetools-linux-16111833_latest.zip; SHA1=e025545c62a8e64c7559119566a569fb1dec5f60 ;;
  *) echo 'Use macOS or Linux for this build script.'; exit 1 ;;
esac
mkdir -p "$TOOLS/downloads" "$ANDROID_HOME/cmdline-tools"
SDKMANAGER="$ANDROID_HOME/cmdline-tools/23.0/bin/sdkmanager"
if [[ ! -x "$SDKMANAGER" ]]; then
  DOWNLOAD="$TOOLS/downloads/$ARCHIVE"
  [[ -f "$DOWNLOAD" ]] || curl -fL --retry 3 "https://dl.google.com/android/repository/$ARCHIVE" -o "$DOWNLOAD"
  printf '%s  %s\n' "$SHA1" "$DOWNLOAD" | shasum -a 1 --check
  STAGING="$(mktemp -d "$TOOLS/android-tools.XXXXXX")"
  unzip -q "$DOWNLOAD" -d "$STAGING"
  mv "$STAGING/cmdline-tools" "$ANDROID_HOME/cmdline-tools/23.0"
  rmdir "$STAGING"
fi
# Tools 23 ship the new Android CLI. Its install command accepts the SDK license
# as part of installation and supports disabling optional metrics collection.
ANDROID="$ANDROID_HOME/cmdline-tools/23.0/bin/android"
cd "$ROOT"
# Versions come from the installed, lockfile-pinned React Native release.
read -r COMPILE BUILD_TOOLS NDK < <(node - <<'NODE'
const fs = require('node:fs');
const catalog = fs.readFileSync('node_modules/react-native/gradle/libs.versions.toml', 'utf8');
const get = name => catalog.match(new RegExp(`^${name} = "([^"]+)"`, 'm'))?.[1];
const versions = ['compileSdk', 'buildTools', 'ndkVersion'].map(get);
if (versions.some(v => !v)) throw new Error('Cannot resolve Android versions from React Native');
console.log(versions.join(' '));
NODE
)
PLATFORM="$COMPILE"
[[ "$COMPILE" != 37 ]] || PLATFORM=37.0
for PACKAGE in 'platform-tools@37.0.1' "platforms/android-$PLATFORM" "build-tools/$BUILD_TOOLS" "ndk/$NDK" 'cmake/3.30.5'; do
  "$ANDROID" --no-metrics --sdk="$ANDROID_HOME" sdk install "$PACKAGE"
done
printf 'Android SDK ready: %s (API %s, Build Tools %s, NDK %s, CMake 3.30.5)\n' "$ANDROID_HOME" "$COMPILE" "$BUILD_TOOLS" "$NDK"

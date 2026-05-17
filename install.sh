#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Hyper Motion — one-line installer.
#
# Pulls the latest signed-but-not-notarized DMG from GitHub Releases,
# copies the .app into /Applications, strips macOS download quarantine,
# re-applies a local ad-hoc signature, and opens the app. End result:
# the app launches the same way a notarized App Store install would —
# no "damaged" dialog, no terminal-fu required after this one command.
#
# Usage (terminal):
#
#   curl -fsSL https://raw.githubusercontent.com/psiddharthdesign/hypermotion/main/install.sh | bash
#
# Or for a specific version:
#
#   curl -fsSL https://raw.githubusercontent.com/psiddharthdesign/hypermotion/main/install.sh | bash -s -- v0.1.6
#
# Works for every future release without changes — the script always
# resolves the latest tag from the GitHub API unless you pass one.

set -euo pipefail

REPO="psiddharthdesign/hypermotion"
APP_NAME="hyper-motion"
INSTALL_DIR="/Applications"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "✗ This installer is macOS-only. Windows builds are coming in a later v0.1.x release." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "✗ curl is required and not installed." >&2
  exit 1
fi

# Detect Apple Silicon vs Intel so we pick the right DMG asset. The
# release workflow publishes arm64 + x64 variants under electron-builder's
# default naming (`${productName}-${version}-${arch}.${ext}` for arm64,
# `${productName}-${version}.${ext}` for x64).
ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ARCH_SUFFIX="-arm64" ;;
  x86_64) ARCH_SUFFIX="" ;;
  *)
    echo "✗ Unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Resolve which version to fetch
# ---------------------------------------------------------------------------

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  # Latest release. The GH API returns the "latest" non-prerelease tag.
  TAG="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' \
    | head -n1 \
    | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
fi

if [[ -z "$TAG" ]]; then
  echo "✗ Could not resolve the latest release tag from GitHub." >&2
  exit 1
fi

# Strip any leading "v" so we can build the DMG filename. The release
# artifacts are named `hyper-motion-<version>-<arch>.dmg` (Apple Silicon)
# or `hyper-motion-<version>.dmg` (Intel).
VERSION="${TAG#v}"
DMG_NAME="${APP_NAME}-${VERSION}${ARCH_SUFFIX}.dmg"
DOWNLOAD_URL="https://github.com/$REPO/releases/download/${TAG}/${DMG_NAME}"

echo "→ Installing Hyper Motion $TAG ($ARCH)"
echo "  $DOWNLOAD_URL"

# ---------------------------------------------------------------------------
# Download + verify
# ---------------------------------------------------------------------------

TMP_DIR="$(mktemp -d -t hyper-motion-install.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
DMG_PATH="$TMP_DIR/$DMG_NAME"

if ! curl -fL --progress-bar -o "$DMG_PATH" "$DOWNLOAD_URL"; then
  echo "✗ Failed to download $DOWNLOAD_URL" >&2
  echo "  Check https://github.com/$REPO/releases for the right asset name." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Mount, copy, eject
# ---------------------------------------------------------------------------

MOUNT_POINT="$(mktemp -d -t hyper-motion-mount.XXXXXX)"
hdiutil attach -nobrowse -quiet -mountpoint "$MOUNT_POINT" "$DMG_PATH"

cleanup_mount() {
  hdiutil detach "$MOUNT_POINT" -quiet || true
  rmdir "$MOUNT_POINT" 2>/dev/null || true
}
trap 'cleanup_mount; rm -rf "$TMP_DIR"' EXIT

SOURCE_APP="$(find "$MOUNT_POINT" -maxdepth 2 -name "${APP_NAME}.app" -type d | head -n1)"
if [[ -z "$SOURCE_APP" ]]; then
  echo "✗ No ${APP_NAME}.app found inside the DMG." >&2
  exit 1
fi

TARGET_APP="$INSTALL_DIR/${APP_NAME}.app"
echo "→ Copying to $TARGET_APP"

# Quit any running instance so we can replace the bundle cleanly.
osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
sleep 1

rm -rf "$TARGET_APP"
cp -R "$SOURCE_APP" "$TARGET_APP"

# ---------------------------------------------------------------------------
# Strip quarantine + ad-hoc sign
# ---------------------------------------------------------------------------

# `xattr -cr` clears every extended attribute on the bundle. Without
# this, macOS Gatekeeper would block the unsigned binary with the
# "Hyper Motion is damaged" dialog.
xattr -cr "$TARGET_APP"

# Re-apply an ad-hoc signature so the system loader trusts the binary.
# `--deep` covers nested frameworks (Electron's Helper apps); `-` is
# Apple's special identity for ad-hoc (no Developer ID involved).
codesign --force --deep --sign - "$TARGET_APP" >/dev/null 2>&1

# ---------------------------------------------------------------------------
# Open
# ---------------------------------------------------------------------------

echo "✓ Installed $APP_NAME $TAG"
open "$TARGET_APP"

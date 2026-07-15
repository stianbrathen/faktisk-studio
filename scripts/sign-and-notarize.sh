#!/bin/bash
# Manual sign + notarize + staple + DMG-build flow.
# Used because electron-builder's default sign path keeps tripping on
# "resource fork, Finder information, or similar detritus not allowed".
#
# Prereqs (must be exported in current shell):
#   APPLE_ID
#   APPLE_APP_SPECIFIC_PASSWORD
#   APPLE_TEAM_ID
#
# Assumes electron-builder has already produced dist/mac-arm64/Faktisk Studio.app
set -e

APP_NAME="Faktisk Studio"
# Fil-safe navn (uten space) for alle distribusjons-artefakter — unngår URL-encoding-
# mismatch mellom lokal fil, GitHub-asset og electron-updater's yml-referanse.
APP_NAME_SAFE="Faktisk-Studio"
APP_VERSION=$(node -p "require('./package.json').version")
APP_PATH="dist/mac-arm64/${APP_NAME}.app"
DMG_PATH="dist/${APP_NAME_SAFE}-${APP_VERSION}-arm64.dmg"
IDENTITY="Developer ID Application: Stian Brathen (${APPLE_TEAM_ID})"
ENTITLEMENTS="build/entitlements.mac.plist"

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: $APP_PATH not found. Run 'npx electron-builder --mac --dir' first."
  exit 1
fi

for v in APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID; do
  if [ -z "${!v}" ]; then
    echo "ERROR: $v environment variable not set."
    exit 1
  fi
done

echo "==> Step 0/6: Generer app-update.yml (electron-updater feed-config)"
# Nuclear ditto-rebuild kan strippe filer som electron-builder normalt legger inn.
# app-update.yml MÅ ligge i Contents/Resources/ ellers får electron-updater ENOENT.
# Filen forteller autoUpdater hvor den skal lete etter oppdateringer.
UPDATE_YML="$APP_PATH/Contents/Resources/app-update.yml"
mkdir -p "$(dirname "$UPDATE_YML")"
cat > "$UPDATE_YML" <<EOF
provider: github
owner: stianbrathen
repo: faktiskorg-studio-plugins
updaterCacheDirName: faktisk-studio-updater
EOF
echo "    Skrev $UPDATE_YML"

echo "==> Step 1/6: Nuclear clean — ditto-rebuild the whole .app without xattrs"
# The single most reliable way to ensure no extended attributes anywhere
# (including com.apple.FinderInfo on the bundle directory itself).
# Slower than xattr -cr but guaranteed to work.
TMP_APP="${APP_PATH}.cleanrebuild"
rm -rf "$TMP_APP"
ditto --noextattr --norsrc "$APP_PATH" "$TMP_APP"
rm -rf "$APP_PATH"
mv "$TMP_APP" "$APP_PATH"

# Belt-and-suspenders cleanup of anything that might have crept back
xattr -cr "$APP_PATH" 2>/dev/null || true
xattr -d com.apple.FinderInfo "$APP_PATH" 2>/dev/null || true
find "$APP_PATH" -name ".DS_Store" -delete 2>/dev/null
find "$APP_PATH" -name "._*" -delete 2>/dev/null

# Verify FinderInfo is gone
if xattr "$APP_PATH" | grep -q FinderInfo; then
  echo "WARNING: com.apple.FinderInfo is STILL on the .app after ditto rebuild!"
  echo "         macOS is re-attaching it automatically (likely iCloud Drive sync)."
  echo "         Try moving the project OUT of Documents/ to e.g. ~/Projects/"
fi

echo "==> Step 2/6: Strip ALL existing signatures (so codesign signs from scratch)"
# Helper apps must be unsigned first
find "$APP_PATH" -type d \( -name "*.app" -o -name "*.framework" \) -print0 | \
  while IFS= read -r -d '' bundle; do
    codesign --remove-signature "$bundle" 2>/dev/null || true
  done
# All executable files
find "$APP_PATH/Contents/Frameworks" -type f -perm +111 -exec codesign --remove-signature {} \; 2>/dev/null || true
# Main bundle
codesign --remove-signature "$APP_PATH" 2>/dev/null || true

echo "==> Step 3/6: Sign all binaries from inside out"
xattr -cr "$APP_PATH"
find "$APP_PATH" -name "._*" -delete 2>/dev/null

# Helper that NUKES all extended attributes and resource forks before
# signing. Uses `ditto --noextattr --norsrc` to make a clean copy of the
# file (drops xattrs/resource forks at copy time), then replaces original.
# For bundles (directories), falls back to xattr -cr since ditto file-copy
# doesn't apply.
sign_clean() {
  local target="$1"
  shift
  # Walk up parent dirs to find any enclosing .app/.framework bundle and
  # explicitly delete its FinderInfo xattr — that's the one that codesign
  # refuses to ignore.
  local p="$target"
  while [ "$p" != "/" ] && [ "$p" != "." ]; do
    if [[ "$p" == *.app || "$p" == *.framework ]]; then
      xattr -d com.apple.FinderInfo "$p" 2>/dev/null || true
      xattr -cr "$p" 2>/dev/null || true
    fi
    p=$(dirname "$p")
  done
  if [ -f "$target" ]; then
    chmod u+w "$target" 2>/dev/null || true
    ditto --noextattr --norsrc "$target" "${target}.clean" 2>/dev/null
    if [ -f "${target}.clean" ]; then
      mv -f "${target}.clean" "$target"
    fi
  fi
  xattr -cr "$target" 2>/dev/null || true
  xattr -d com.apple.FinderInfo "$target" 2>/dev/null || true
  find "$target" -name "._*" -delete 2>/dev/null || true
  codesign --force --timestamp --options runtime "$@" --sign "$IDENTITY" "$target"
}

# 3a-b) Sign EVERY Mach-O binary inside the app, detected via the `file`
#       command. This catches dylibs, embedded executables, helper binaries
#       inside frameworks (chrome_crashpad_handler, ShipIt, etc), and the
#       MacOS binary inside each helper .app — regardless of permissions
#       or file extension. Slower than perm-based find, but bulletproof.
echo "    [3a-b] Signing isolated dylibs and embedded helpers"
COUNT=0
while IFS= read -r -d '' f; do
  case "$f" in
    */Contents/MacOS/*) continue ;;
  esac
  TYPE=$(file -b "$f" 2>/dev/null)
  if [[ "$TYPE" == *"Mach-O"* ]]; then
    sign_clean "$f"
    COUNT=$((COUNT + 1))
  fi
done < <(find "$APP_PATH" -type f \
  \( -name "*.dylib" -o -path "*/Helpers/*" -o -name "ShipIt" -o -path "*/app.asar.unpacked/*" \) \
  -print0)
echo "    Signed $COUNT isolated binaries"

# 3c) Sign Helper apps. Re-clean each one right before signing,
#     because steps 3a/3b may have added metadata to files inside.
echo "    [3c] Signing Helper apps"
find "$APP_PATH/Contents/Frameworks" -type d -name "*.app" -print0 | while IFS= read -r -d '' helper; do
  sign_clean "$helper" --entitlements "$ENTITLEMENTS"
done

# 3d) Sign frameworks (Electron Framework, Squirrel)
echo "    [3d] Signing frameworks"
find "$APP_PATH/Contents/Frameworks" -type d -name "*.framework" -print0 | while IFS= read -r -d '' fw; do
  sign_clean "$fw"
done

# 3e) Finally sign the main .app bundle
echo "    [3e] Signing main app bundle"
sign_clean "$APP_PATH" --entitlements "$ENTITLEMENTS"

echo "==> Step 4/6: Verify signature"
codesign --verify --verbose=2 "$APP_PATH"

echo "==> Step 5/6: Notarize (this can take 5-15 min)"
ZIP_PATH="/tmp/faktisk-studio-notarize.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

xcrun notarytool submit "$ZIP_PATH" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

rm -f "$ZIP_PATH"

echo "==> Step 6/6: Staple notarization ticket to .app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "==> Building DMG"
# Simple DMG using built-in macOS tools
DMG_TMP="dist/${APP_NAME}-temp.dmg"
rm -f "$DMG_TMP" "$DMG_PATH"
hdiutil create -volname "$APP_NAME" -srcfolder "$APP_PATH" -ov -format UDZO "$DMG_PATH"

# ============================================================
#  Auto-update-artefakter: signert ZIP + latest-mac.yml
#  electron-updater bruker ZIP-filen til nedlasting og latest-mac.yml
#  som feed-fil (fetches fra GitHub Release-assets).
# ============================================================
echo "==> Bygger ZIP for auto-updater"
ZIP_NAME="${APP_NAME_SAFE}-${APP_VERSION}-arm64-mac.zip"
ZIP_PATH_OUT="dist/${ZIP_NAME}"
rm -f "$ZIP_PATH_OUT"
# --sequesterRsrc: bevarer resource forks korrekt så ZIP-en kan pakkes ut igjen som gyldig .app
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$ZIP_PATH_OUT"

echo "==> Genererer latest-mac.yml"
YML_PATH="dist/latest-mac.yml"

# Base64-kodet SHA-512 (formatet electron-updater forventer)
b64sha512() {
  shasum -a 512 "$1" | awk '{print $1}' | xxd -r -p | base64
}

ZIP_SIZE=$(stat -f%z "$ZIP_PATH_OUT")
ZIP_SHA=$(b64sha512 "$ZIP_PATH_OUT")
DMG_NAME="${APP_NAME_SAFE}-${APP_VERSION}-arm64.dmg"
DMG_SIZE=$(stat -f%z "$DMG_PATH")
DMG_SHA=$(b64sha512 "$DMG_PATH")

# ISO 8601-tidspunkt (UTC)
RELEASE_DATE=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

cat > "$YML_PATH" <<EOF
version: ${APP_VERSION}
files:
  - url: ${ZIP_NAME}
    sha512: ${ZIP_SHA}
    size: ${ZIP_SIZE}
  - url: ${DMG_NAME}
    sha512: ${DMG_SHA}
    size: ${DMG_SIZE}
path: ${ZIP_NAME}
sha512: ${ZIP_SHA}
releaseDate: '${RELEASE_DATE}'
EOF

echo ""
echo "✅ Done!"
echo "   App:  $APP_PATH"
echo "   DMG:  $DMG_PATH  (menneske-download)"
echo "   ZIP:  $ZIP_PATH_OUT  (auto-updater)"
echo "   YML:  $YML_PATH  (feed for electron-updater)"
echo ""
echo "For å publisere en ny versjon:"
echo "  1) Opprett en GitHub Release med tag v${APP_VERSION} på stianbrathen/faktiskorg-studio-plugins"
echo "  2) Last opp DISSE tre filene som release-assets:"
echo "       - ${DMG_NAME}"
echo "       - ${ZIP_NAME}"
echo "       - latest-mac.yml"
echo "  3) Klikk 'Publish release' (må være 'release', ikke 'draft' eller 'prerelease')"
echo "  4) Installerte klienter oppdager oppdateringen ved neste oppstart (eller innen 4 t)"

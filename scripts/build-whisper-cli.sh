#!/usr/bin/env bash
# Bygger en selvstendig whisper-cli-binær for distribusjon via Studio.
#
# Hvorfor ikke brew-binæren: den er dynamisk lenket mot /opt/homebrew-
# biblioteker (libwhisper, libggml) som ikke finnes hos journalistene.
# Denne bygger statisk — én fil uten avhengigheter utover macOS selv,
# med Metal-akselerasjon.
#
# Bruk:
#   ./scripts/build-whisper-cli.sh
#
# Krav: Xcode Command Line Tools + cmake (brew install cmake om den mangler)
#
# Etterpå: last opp binæren til GitHub-releasen og lim sha256 inn i
# WHISPER_CLI_TOOL i main.js (scriptet skriver ut begge deler).

set -euo pipefail

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "→ Kloner whisper.cpp…"
git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$WORK/whisper.cpp"
cd "$WORK/whisper.cpp"
VERSION=$(git describe --tags --always 2>/dev/null || echo "unknown")
echo "  versjon: $VERSION"

echo "→ Bygger statisk (Metal på, ingen delte biblioteker)…"
cmake -B build \
  -DBUILD_SHARED_LIBS=OFF \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_BUILD_TESTS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DGGML_NATIVE=OFF \
  > /dev/null
# GGML_NATIVE=OFF: uten denne kompileres det med -mcpu=native, optimalisert
# for BYGGEMASKINENS brikke — kan krasje på eldre M-brikker (feks M1 hos en
# journalist når det bygges på M3/M4). Portabel bygging koster lite ytelse
# siden Metal uansett gjør tungarbeidet.
cmake --build build --target whisper-cli -j "$(sysctl -n hw.ncpu)" > /dev/null

BIN="build/bin/whisper-cli"
[ -f "$BIN" ] || { echo "❌ Bygget feilet — fant ikke $BIN"; exit 1; }

echo ""
echo "→ Verifiserer at binæren er selvstendig (kun system-biblioteker):"
if otool -L "$BIN" | grep -vE '^\S|/usr/lib/|/System/'; then
  echo "❌ Binæren lenker mot ikke-system-biblioteker (vist over) — IKKE distribuer."
  exit 1
fi
otool -L "$BIN" | sed 's/^/  /'

echo ""
echo "→ Signerer med Developer ID…"
IDENTITY=$(security find-identity -v -p codesigning | grep "Developer ID Application" | head -1 | sed 's/.*"\(.*\)"/\1/')
if [ -z "$IDENTITY" ]; then
  echo "⚠ Fant ingen Developer ID Application-identitet — signerer ad-hoc."
  echo "  (Fungerer likevel: Studio laster ned uten quarantine-attributt.)"
  codesign --force -s - "$BIN"
else
  echo "  identitet: $IDENTITY"
  codesign --force --options runtime --timestamp -s "$IDENTITY" "$BIN"
fi
codesign -v "$BIN" && echo "  ✓ signatur OK"

OUT="$HOME/Desktop/whisper-cli-arm64"
cp "$BIN" "$OUT"
SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
SIZE=$(du -h "$OUT" | awk '{print $1}')

echo ""
echo "============================================================"
echo "✅ Ferdig: $OUT ($SIZE, whisper.cpp $VERSION)"
echo ""
echo "1) Last opp til verktøy-releasen:"
echo "   gh release create tools-v1 --repo stianbrathen/faktiskorg-studio-plugins \\"
echo "     --title \"Verktøy for Faktisk Studio\" \\"
echo "     --notes \"Selvstendige binærer som Studio laster ned ved behov\" \\"
echo "     \"$OUT\" 2>/dev/null \\"
echo "   || gh release upload tools-v1 --repo stianbrathen/faktiskorg-studio-plugins \"$OUT\" --clobber"
echo ""
echo "2) Lim inn i WHISPER_CLI_TOOL i main.js:"
echo "   sha256: '$SHA'"
echo "============================================================"

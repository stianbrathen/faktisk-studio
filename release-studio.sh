#!/usr/bin/env bash
# release-studio.sh — bygg + signer + notariser + publiser Faktisk Studio.
#
# Bruk:
#   ./release-studio.sh <versjon> "<release notes>"
#
# Eksempel:
#   ./release-studio.sh 0.5.7 "Fikset Labrador-integrasjon i alle plugins"
#
# Forutsetter:
#   - Kjøres fra Faktisk Studio-repoens rot
#   - package.json er allerede bumpet til <versjon>
#   - Apple-credentials satt som env-vars ELLER lagret i Keychain
#     under service "faktisk-studio-notarize" (item: apple_password)
#   - gh CLI innlogget
#   - node, npm, gh, security tilgjengelig
#
# Scriptet fanger vanlige feilmoduser:
#   - Versjonsmismatch mellom argument og package.json
#   - Manglende Apple-credentials
#   - Filnavn med mellomrom (electron-updater krasjer)
#   - Reuse av eksisterende versjon-tag (GitHub avviser)

set -euo pipefail

VERSION="${1:-}"
NOTES="${2:-}"

if [[ -z "$VERSION" || -z "$NOTES" ]]; then
  cat <<EOF
Bruk: $0 <versjon> "<release notes>"

Eksempel:
  $0 0.5.7 "Fikset Labrador-integrasjon i alle plugins"

Krever at package.json allerede er bumpet.
EOF
  exit 1
fi

# Semver-sjekk
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Versjon må være semver (X.Y.Z), fikk: $VERSION"
  exit 1
fi

# Sjekk at package.json matcher
PKG_VERSION=$(node -e "console.log(require('./package.json').version)")
if [[ "$PKG_VERSION" != "$VERSION" ]]; then
  echo "❌ Versjonsmismatch:"
  echo "   Argument:     $VERSION"
  echo "   package.json: $PKG_VERSION"
  echo ""
  echo "   Kjør: npm version $VERSION --no-git-tag-version"
  exit 1
fi

# Sett Apple-credentials — enten fra env eller Keychain
export APPLE_ID="${APPLE_ID:-stian.brathen@mac.com}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-W75MQ2URJN}"

if [[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
  echo "→ Henter APPLE_APP_SPECIFIC_PASSWORD fra Keychain..."
  if APPLE_APP_SPECIFIC_PASSWORD=$(security find-generic-password -s "faktisk-studio-notarize" -a "apple_password" -w 2>/dev/null); then
    export APPLE_APP_SPECIFIC_PASSWORD
    echo "  ✓ Hentet fra Keychain"
  else
    cat <<EOF
❌ APPLE_APP_SPECIFIC_PASSWORD er ikke satt og finnes ikke i Keychain.

Alternativer:
  1) Sett env-var: export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
  2) Lagre i Keychain (én gang, så husker macOS det):
     security add-generic-password -s "faktisk-studio-notarize" -a "apple_password" -w "xxxx-xxxx-xxxx-xxxx"

App-spesifikt passord finner du på account.apple.com → Sign-In and Security → App-Specific Passwords.
EOF
    exit 1
  fi
fi

echo "✓ APPLE_ID:      $APPLE_ID"
echo "✓ APPLE_TEAM_ID: $APPLE_TEAM_ID"
echo "✓ APPLE_APP_SPECIFIC_PASSWORD: (satt, ${#APPLE_APP_SPECIFIC_PASSWORD} tegn)"
echo ""

# Sjekk om release med samme tag allerede eksisterer
if gh release view "v$VERSION" --repo stianbrathen/faktiskorg-studio-plugins &>/dev/null; then
  echo "⚠ Release v$VERSION finnes allerede på GitHub."
  read -p "  Slett den og lag på nytt? [y/N] " DELETE_CONFIRM
  if [[ "$DELETE_CONFIRM" == "y" || "$DELETE_CONFIRM" == "Y" ]]; then
    gh release delete "v$VERSION" --repo stianbrathen/faktiskorg-studio-plugins --yes --cleanup-tag
    echo "  ✓ Slettet"
  else
    echo "Avbrutt. Bump versjon eller slett release manuelt."
    exit 1
  fi
fi

# Bygg + signer + notariser
echo ""
echo "→ Bygger + signerer + notariserer (kan ta 5-10 min)..."
npm run build:mac

# Verifiser at forventede filer eksisterer med rett navn (bindestrek, ikke mellomrom)
EXPECTED_DMG="dist/Faktisk-Studio-${VERSION}-arm64.dmg"
EXPECTED_ZIP="dist/Faktisk-Studio-${VERSION}-arm64-mac.zip"
EXPECTED_YML="dist/latest-mac.yml"

for f in "$EXPECTED_DMG" "$EXPECTED_ZIP" "$EXPECTED_YML"; do
  if [[ ! -f "$f" ]]; then
    echo "❌ Forventet build-artifakt mangler: $f"
    echo "   Sjekk at sign-and-notarize.sh bruker APP_NAME_SAFE=\"Faktisk-Studio\" (bindestrek)."
    exit 1
  fi
done

echo ""
echo "✓ Build-artifakter OK:"
ls -lh "$EXPECTED_DMG" "$EXPECTED_ZIP" "$EXPECTED_YML" | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# Publiser
echo "→ Publiserer v$VERSION til GitHub Releases..."
gh release create "v$VERSION" \
  --repo stianbrathen/faktiskorg-studio-plugins \
  --title "Faktisk Studio $VERSION" \
  --notes "$NOTES" \
  "$EXPECTED_DMG" \
  "$EXPECTED_ZIP" \
  "$EXPECTED_YML"

echo ""
echo "→ Verifiserer release..."
gh release view "v$VERSION" --repo stianbrathen/faktiskorg-studio-plugins | head -20

echo ""
echo "✅ Ferdig. Faktisk Studio v$VERSION er publisert."
echo "   Auto-updater vil tilby oppdateringen ved neste Studio-restart."

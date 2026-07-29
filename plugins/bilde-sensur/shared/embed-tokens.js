// Faktisk embed-tokens — sentral kilde for alle plugins.
//
// Dette er den KANONISKE kopien. Ved bygging av bundle.json kopieres denne
// filen inn i hver plugin/<id>/shared/embed-tokens.js. Alle plugins bruker
// window.FaktiskEmbedBase.* i sin buildEmbedSnippet.
//
// Tokens matcher faktisk.no sin typografi:
// - Unica77 er UI/caption/factbox-fonten
// - #0050FC er Faktisk brand-blå
// - Font-vektene 300/500 er de Labrador-siden faktisk laster
//
// Endringer her får effekt i alle embeds ved neste build+release.
// I fremtidig native-migrering vil Labrador-temaet definere de samme
// --fk-*-variablene på artikkel-nivå, og embeds arver dem gratis.

(function (root) {
  'use strict';

  const TOKENS = {
    // Typografi
    font:         '"Unica77", "Helvetica Neue", Helvetica, Arial, sans-serif',
    fwNormal:     300,   // Unica77 Light
    fwBold:       500,   // Unica77 Medium
    lineHeight:   1.4,

    // Farger
    ink:          '#212121',   // hovedtekst
    inkDim:       '#5A5A5A',   // sekundærtekst
    white:        '#FFFFFF',
    blue:         '#0050FC',   // Faktisk brand-blå
    surface:      '#D9D9D9',   // container-bakgrunn (lys grå)
    surfaceDark:  '#C3C3C3',   // mørkere container (feks bildeanalyse par-container)

    // Geometri
    radiusSm:     '4px',
    radiusMd:     '8px',
    radiusLg:     '16px',

    // Skygger
    shadowSm:     '0 2px 8px rgba(0,0,0,0.10)',
    shadowMd:     '0 4px 16px rgba(0,0,0,0.15)',
    shadowLg:     '0 10px 30px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',

    // Spacing (unicorn-scale)
    spaceXs:      '4px',
    spaceSm:      '8px',
    spaceMd:      '16px',
    spaceLg:      '24px',
    spaceXl:      '32px',
  };

  /**
   * Genererer CSS-variabel-blokka som skal ligge på embed-roten.
   * Kall denne først i buildEmbedSnippet slik at plugin-spesifikk CSS
   * kan bruke `var(--fk-blue)`, `var(--fk-font)` osv.
   *
   * @param {string} scope - Klassen som identifiserer denne embed-instansen
   *                        (feks 'ffes-abc123' eller 'banl-xyz789')
   * @returns {string} CSS-tekst
   */
  function getBaseCss(scope) {
    return `
    .${scope} {
      --fk-font: ${TOKENS.font};
      --fk-fw-normal: ${TOKENS.fwNormal};
      --fk-fw-bold: ${TOKENS.fwBold};
      --fk-line-height: ${TOKENS.lineHeight};
      --fk-ink: ${TOKENS.ink};
      --fk-ink-dim: ${TOKENS.inkDim};
      --fk-white: ${TOKENS.white};
      --fk-blue: ${TOKENS.blue};
      --fk-surface: ${TOKENS.surface};
      --fk-surface-dark: ${TOKENS.surfaceDark};
      --fk-radius-sm: ${TOKENS.radiusSm};
      --fk-radius-md: ${TOKENS.radiusMd};
      --fk-radius-lg: ${TOKENS.radiusLg};
      --fk-shadow-sm: ${TOKENS.shadowSm};
      --fk-shadow-md: ${TOKENS.shadowMd};
      --fk-shadow-lg: ${TOKENS.shadowLg};
      --fk-space-xs: ${TOKENS.spaceXs};
      --fk-space-sm: ${TOKENS.spaceSm};
      --fk-space-md: ${TOKENS.spaceMd};
      --fk-space-lg: ${TOKENS.spaceLg};
      --fk-space-xl: ${TOKENS.spaceXl};

      font-family: var(--fk-font);
      font-weight: var(--fk-fw-normal);
      line-height: var(--fk-line-height);
      color: var(--fk-ink);
    }`;
  }

  root.FaktiskEmbedBase = { TOKENS, getBaseCss };
})(typeof window !== 'undefined' ? window : globalThis);

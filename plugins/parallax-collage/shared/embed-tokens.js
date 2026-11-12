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


  /**
   * Beskytter en embed mot stilarket på siden den limes inn i (faktisk.no / Labrador).
   * Opt-in: kall på hele CSS-teksten til embedden før den legges i <style>.
   *  - roten (.scope) nullstilles med all:initial og får Faktisk-font/farge/linjehøyde
   *  - alle etterkommere nullstilles (margin, padding, border, font, listetegn …)
   *  - alle regler prefikses med dobbel rotklasse (.scope.scope …) så de veier tyngre enn sidens regler
   *  - font-weight bold/600/700 → 500 og normal/400 → 300 (faktisk.no laster bare Unica77 300 og 500)
   * Sidens regler med !important kan ingen embed overstyre.
   *
   * @param {string} css   - embeddens CSS
   * @param {string} scope - klassen på embeddens rot-element (uten punktum)
   * @returns {string} beskyttet CSS
   */
  function isolate(css, scope) {
    const R = '.' + scope, RR = R + R;
    css = String(css || '')
      .replace(/font-weight:\s*(bold|700|600|bolder)\b/g, 'font-weight: ' + TOKENS.fwBold)
      .replace(/font-weight:\s*(normal|400)\b/g, 'font-weight: ' + TOKENS.fwNormal);
    function fixSel(sel) {
      return sel.split(',').map(s => s.trim()).filter(Boolean).map(s => {
        if (s.startsWith(R) && !/[\w-]/.test(s.charAt(R.length) || ' ')) return RR + s.slice(R.length);
        return RR + ' ' + s;
      }).join(',');
    }
    function walk(src) {
      let out = '', i = 0;
      while (i < src.length) {
        const j = src.indexOf('{', i);
        if (j < 0) { out += src.slice(i); break; }
        const head = src.slice(i, j), hs = head.trim();
        if (hs.charAt(0) === '@') {
          let depth = 1, k = j + 1;
          while (k < src.length && depth) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
          const inner = src.slice(j + 1, k - 1);
          out += head + '{' + (/^@(media|container|supports)/.test(hs) ? walk(inner) : inner) + '}';
          i = k; continue;
        }
        const k = src.indexOf('}', j);
        out += head.slice(0, head.length - head.trimStart().length) + fixSel(hs) + src.slice(j, k + 1);
        i = k + 1;
      }
      return out;
    }
    const reset = `
    ${RR} { all: initial; display: block; box-sizing: border-box; font-family: ${TOKENS.font}; font-weight: ${TOKENS.fwNormal};
      line-height: ${TOKENS.lineHeight}; color: ${TOKENS.ink}; text-align: left; -webkit-font-smoothing: antialiased; }
    ${RR} *, ${RR} *::before, ${RR} *::after { box-sizing: border-box; margin: 0; padding: 0; border: 0; background: none;
      font: inherit; line-height: inherit; color: inherit; letter-spacing: normal; text-transform: none; text-indent: 0;
      text-decoration: none; text-align: inherit; list-style: none; float: none; max-width: none; min-width: 0;
      min-height: 0; box-shadow: none; outline: 0; quotes: none; vertical-align: baseline; }
    ${RR} img, ${RR} svg, ${RR} canvas, ${RR} video { display: block; max-width: none; height: auto; }
`;
    return reset + walk(css);
  }

  root.FaktiskEmbedBase = { TOKENS, getBaseCss, isolate };
})(typeof window !== 'undefined' ? window : globalThis);

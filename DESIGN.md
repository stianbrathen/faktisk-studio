# Faktisk Studio — Designsystem

Felles design-tokens for plugins i Faktisk Studio. Hold denne dokumentasjonen oppdatert når nye konvensjoner etableres.

---

## Farger

### Brand
| Token | Verdi | Bruk |
|---|---|---|
| `--faktisk-blue` | `#0050FC` | Primær brand-farge: knapper, ramme på blå markering, peker fra overskrifter, fyllt prikk |
| `--faktisk-blue-hover` | `#0040D9` | Hover på blå knapper |

### Gråtoner (semantisk navngitt)
| Token | Verdi | Bruk |
|---|---|---|
| `--gray-letterbox` | `#1A1A1A` | Letterbox/empty-bg bak bilder, videoplayer-bg |
| `--gray-text` | `#212121` | Mørk tekst, dots active |
| `--gray-text-input` | `#313131` | Tekst inni input/select |
| `--gray-muted` | `#4A4A4A` | Sekundær tekst, dots hover |
| `--gray-dots` | `#6E6E6E` | Inaktive dots i slideshow |
| `--gray-bg-topbar` | `#707070` | Topbar-bakgrunn i Studio |
| `--gray-bg-page` | `#9D9D9D` | Sidebar-bakgrunn (page) |
| `--gray-container` | `#B7B7B7` | Outer container i par-modus |
| `--gray-input` (`--bg-input`) | `#D9D9D9` | Input-bg, caption-boks, lys chip |

### Hvit/sort
- `#FFFFFF` — A/B sirkel-label-bakgrunn, slider-handle, knob, peker fra beskrivelser
- `#000000` — sjelden brukt

---

## Border-radius

Tydelig hierarki — bruk det som passer størrelsen på elementet:

| Verdi | Bruk |
|---|---|
| **`4px`** | Markerings-rammer, små chips, slider-knob, kompakte badge-er |
| **`5px`** | Tekstbokser i embed (tb), Før/Etter-merker |
| **`6px`** | Knapper, input-felt, select, tb-chips, små rader |
| **`10px`** | Bildeceller, mediumstore kort, headers i par-modus, caption-bokser |
| **`14px`** | Outer container (par-modus wrapper) |
| **`50%`** | Sirkler: dots, A/B-labels, peker-prikker, scale-handle, play-knapp |

**Standard:** når i tvil, velg den mest brukte verdien for elementets størrelse.

---

## Box-shadow

| Stil | Bruk |
|---|---|
| `0 1px 4px rgba(0,0,0,0.5)` | Subtil — små elementer (peker-prikk, knob) |
| `0 2px 6px rgba(0,0,0,0.3)` | Standard — bilde/cell, A/B-labels, marker-bokser |
| `0 2px 8px rgba(0,0,0,0.25)` | Soft — alternativ for større elementer |
| `0 6px 18px rgba(0,0,0,0.22)` | Hover-lift — når elementet løfter seg (interaktivt) |
| `0 24px 60px rgba(0,0,0,0.4)` | Modal/dialog — kraftig dyp |

**Hover-pattern:** `transform: translateY(-2px)` + større skygge.

---

## Padding

### Knapper
- **Mini-knapp (`btn-mini`):** `5px 9px` med `font-size: 12px`
- **Standard-knapp:** høyde 36-44px med `padding: 0 14-22px`
- **Primær-knapp (`btn-primary`):** høyde 52px med `padding: 0 22px`

### Input/select
- **Liten input:** høyde 32px med `padding: 0 11px`
- **Standard input (URL-felt):** høyde 44-52px med `padding: 0 14px`
- **Caption-textarea:** `padding: 6px 11px`, line-height 1.3

### Tekstbokser på bilde
- **Heading/dark:** `padding: 0.3em 0.65em` (em-basert, skalerer med font)
- **Description/light:** `padding: 0.45em 0.95em` (mer luft for lengre tekst)

### Containere
- **Pair-wrapper outer:** `padding: 20px 40px` (Studio), `clamp(14-24px, ..., 20-50px)` (embed)
- **Caption-boks:** `padding: 16px 24px`
- **Sidebar:** `padding: 0 4px 4px`

---

## Typografi

| Bruk | Font | Størrelse |
|---|---|---|
| Plugin-tittel | bold | 22px |
| Section-label | bold | 12-13px |
| Knapp | bold | 12-15px |
| Tekstboks overskrift (embed) | bold | `clamp(14px, 1.8cqw, 26px)` |
| Tekstboks beskrivelse (embed) | regular | `clamp(13px, 1.6cqw, 22px)` |
| A/B-label sirkel | bold | `clamp(14-20px)` |
| Status/hint-tekst | regular | 11-12px |

**Font-stack i embed:** `"Haas Grot Text 75 Bold", "Helvetica Neue", Helvetica, Arial, sans-serif` (bold) eller `"Haas Grot Text 55 Roman"` (regular).

---

## Avstander (gap)

| Kontekst | Verdi |
|---|---|
| Mellom sidebar-seksjoner | 12px |
| Innen seksjon (felt + label) | 4-8px |
| Mellom dots i slideshow | 8px |
| Mellom bilder i par/grid | `clamp(16-30px, 2.8cqw, 30px)` |

---

## Interaksjons-patterns

### Hover (cards/cells)
```css
transition: transform 0.18s ease, box-shadow 0.18s ease;
&:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(0,0,0,0.22);
}
```

### Slideshow-dots
- Default: 8×8 sirkel, `#6E6E6E`
- Hover: `#4A4A4A`
- Active: `#212121`, `transform: scale(1.3)`

### Drag-handles (skalering)
- Lite hvitt sirkel (12-18px) med 2px blå border
- Posisjon: nedre-høyre hjørne med `-6px` til `-8px` offset
- `cursor: nwse-resize`

---

## Container queries (embed)

Alle embeds wraps i en `*-container` med `container-type: inline-size`. Bruk `cqw`-enheter for responsiv skalering.

### Side-padding (full-bredde-embed → tekstkolonne på desktop, 1rem på mobil)
```css
@container (min-width: 1080px) {
  .container > .text-element {
    padding-left: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
    padding-right: calc(50cqw - var(--lab_page_width, 68rem) / 2 + 0.7rem) !important;
  }
}
@media (max-width: 768px) {
  .container > .text-element {
    padding-left: 1rem !important;
    padding-right: 1rem !important;
  }
}
```

---

## Sjekkliste når du lager ny plugin

- [ ] Bruker `shared/style.css` for grunntema (kommer fra felles fil)
- [ ] Border-radius matcher tabellen over (4/6/10/14/50%)
- [ ] Box-shadow er én av standardene
- [ ] Knapper er `btn-mini` (kompakt) eller `btn-primary` (full bredde)
- [ ] Bildeceller har `border-radius: 10px` + standard skygge
- [ ] Outer container i par-modus: `#B7B7B7` med `border-radius: 14px`
- [ ] Caption-boks: `#D9D9D9` med `border-radius: 10px`, padding 16×24
- [ ] A/B-label: 36-44px hvit sirkel med shadow, oppe-venstre hjørne av markering
- [ ] Strek mellom markeringer: kant-til-kant, 4-5px tykk, 95% opasitet, `non-scaling-stroke`
- [ ] Container-query padding på alle tekst-elementer (caption, labels, legend)
- [ ] Mobil-tilpasning på alle layouts

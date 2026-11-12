// Faktisk Studio · bildeoptimalisering før opplasting til Labrador
//
// Lager AVIF (hovedformat) + JPG/WebP (reserve) i 1200 og 2400 px bredde fra
// ett originalbilde. Kvaliteten velges per bilde: vi måler hvor likt et
// høykvalitets-JPG (q80) er originalen (SSIM på lyshet), og finner så den
// laveste AVIF-kvaliteten som er minst like god. Slik får portretter, grafikk
// og skjermbilder hver sin innstilling i stedet for én fast verdi.
//
// Bruker sharp (libvips + libaom + mozjpeg + libwebp). Hvis sharp mangler
// eller bildet ikke kan leses (f.eks. HEIC), returneres null og originalen
// lastes opp som før.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let sharpLib;
function loadSharp() {
  if (sharpLib !== undefined) return sharpLib;
  try {
    sharpLib = require('sharp');
    sharpLib.cache(false);
  } catch (e) {
    console.warn('[bildeoptimalisering] sharp ikke tilgjengelig:', e.message);
    sharpLib = null;
  }
  return sharpLib;
}

const OPTIMIZABLE = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const WIDTHS = [1200, 2400];
const MAX_H = 4000;                  // høye portrettbilder kappes ikke, men begrenses
const GREY = { r: 128, g: 128, b: 128 };

// SSIM på lyshet, 8×8-blokker uten overlapp (rask nok for 1200 px i JS).
function ssim(a, b, w, h) {
  const B = 8, C1 = 6.5025, C2 = 58.5225; // (0.01·255)², (0.03·255)²
  let sum = 0, n = 0;
  for (let by = 0; by + B <= h; by += B) {
    for (let bx = 0; bx + B <= w; bx += B) {
      let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
      for (let y = 0; y < B; y++) {
        let i = (by + y) * w + bx;
        for (let x = 0; x < B; x++, i++) {
          const va = a[i], vb = b[i];
          sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb;
        }
      }
      const N = B * B, ma = sa / N, mb = sb / N;
      const va = saa / N - ma * ma, vb = sbb / N - mb * mb, cov = sab / N - ma * mb;
      sum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
      n++;
    }
  }
  return n ? sum / n : 1;
}

// Gråtonebilde (alfa lagt over grått) som Uint8Array i bredde×høyde
async function greyOf(sharp, input, rawInfo) {
  const img = rawInfo ? sharp(input, { raw: rawInfo }) : sharp(input);
  const { data, info } = await img.flatten({ background: GREY }).toColourspace('b-w')
    .raw().toBuffer({ resolveWithObject: true });
  if (info.channels === 1) return { px: data, w: info.width, h: info.height };
  const out = new Uint8Array(info.width * info.height);
  for (let i = 0, j = 0; i < out.length; i++, j += info.channels) out[i] = data[j];
  return { px: out, w: info.width, h: info.height };
}

function encoder(sharp, raw) {
  const base = () => sharp(raw.data, { raw: raw.info });
  return {
    avif: (q, effort, chroma) => base().avif({ quality: q, effort, chromaSubsampling: chroma }).toBuffer(),
    jpeg: (q, chroma) => base().flatten({ background: GREY }).jpeg({ quality: q, mozjpeg: true, chromaSubsampling: chroma }).toBuffer(),
    webp: q => base().webp({ quality: q, alphaQuality: 90, effort: 6, smartSubsample: true }).toBuffer(),
    png: () => base().png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 }).toBuffer(),
  };
}

function baseName(fileName) {
  return path.basename(fileName, path.extname(fileName))
    .replace(/[^\wæøåÆØÅ-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 40) || 'bilde';
}

/**
 * @param {string} filePath  originalfil
 * @param {string} fileName  vasket filnavn (brukes som stamme for nye navn)
 * @param {(label:string, percent:number)=>void} [onStep]
 * @returns {Promise<null|{files:Array, fallbackMime:string, width:number, height:number, alpha:boolean, quality:object, origBytes:number}>}
 */
async function optimizeImage(filePath, fileName, onStep) {
  const sharp = loadSharp();
  if (!sharp || !OPTIMIZABLE.test(fileName)) return null;
  const step = (label, p) => { try { onStep && onStep(label, p); } catch (e) {} };

  const bytes = fs.readFileSync(filePath);
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height) return null;
  if ((meta.pages || 1) > 1) return null; // animert WebP/AVIF: la være
  const rotated = (meta.orientation || 1) >= 5;
  const srcW = rotated ? meta.height : meta.width;

  // Gjennomsiktighet: bare hvis alfakanalen faktisk brukes.
  // Grafikk/skjermbilder (PNG/TIFF/WebP med lav entropi, dvs. flater og tekst)
  // får strengere kvalitetsmål og full fargeoppløsning. Utklipp av foto
  // (f.eks. en hånd uten bakgrunn) har høy entropi og behandles som foto.
  let alpha = !!meta.hasAlpha, entropy = 8;
  try {
    const st = await sharp(bytes).stats();
    if (meta.hasAlpha) alpha = !st.isOpaque;
    if (isFinite(st.entropy)) entropy = st.entropy;
  } catch (e) {}
  const graphic = /png|tiff|webp/.test(meta.format || '') && entropy < 6;
  const chroma = graphic || alpha ? '4:4:4' : '4:2:0';

  let widths = WIDTHS.filter(w => w < srcW * 0.95);
  if (srcW <= WIDTHS[WIDTHS.length - 1] * 1.05) widths.push(srcW);
  widths = Array.from(new Set(widths)).sort((a, b) => a - b);

  const hash = crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 6);
  const stem = baseName(fileName) + '-' + hash;

  const rawFor = async w => {
    const { data, info } = await sharp(bytes).rotate()
      .resize({ width: w, height: MAX_H, fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
      .toColourspace('srgb')[alpha ? 'ensureAlpha' : 'removeAlpha']()
      .raw().toBuffer({ resolveWithObject: true });
    return { data, info: { width: info.width, height: info.height, channels: info.channels } };
  };

  // 1) Velg kvalitet på den minste størrelsen
  step('Analyserer bildet…', 5);
  const small = await rawFor(widths[0]);
  const enc0 = encoder(sharp, small);
  const ref = await greyOf(sharp, small.data, small.info);
  const score = async buf => { const g = await greyOf(sharp, buf); return ssim(ref.px, g.px, ref.w, ref.h); };

  const anchor = await score(await enc0.jpeg(graphic ? 90 : 80, chroma));
  const target = Math.min(0.995, Math.max(0.90, anchor - (graphic ? 0.002 : 0.004)));

  let lo = 40, hi = 85, qA = 85, tries = 0;
  while (lo <= hi && tries < 5) {
    const mid = Math.round((lo + hi) / 2);
    step('Finner beste kvalitet… (' + (tries + 1) + '/5)', 10 + tries * 8);
    const s = await score(await enc0.avif(mid, 4, chroma));
    if (s >= target) { qA = mid; hi = mid - 1; } else { lo = mid + 1; }
    tries++;
  }
  // Reserveformatet: JPG for foto, WebP for foto med gjennomsiktighet.
  // For grafikk prøver vi også tapsfri PNG og tar den minste.
  const qF = graphic ? 90 : 82;
  let fbKind = alpha ? 'webp' : 'jpeg';
  if (graphic) {
    const lossy = alpha ? await enc0.webp(qF) : await enc0.jpeg(qF, chroma);
    const png = await enc0.png();
    if (png.length <= lossy.length * 1.1) fbKind = 'png';
  }
  const fallbackMime = { jpeg: 'image/jpeg', webp: 'image/webp', png: 'image/png' }[fbKind];
  const fallbackExt = { jpeg: 'jpg', webp: 'webp', png: 'png' }[fbKind];

  // 2) Lag alle størrelser
  const files = [];
  for (let i = 0; i < widths.length; i++) {
    const raw = i === 0 ? small : await rawFor(widths[i]);
    const enc = encoder(sharp, raw);
    const w = raw.info.width;
    step('Komprimerer ' + w + ' px…', 50 + Math.round(i / widths.length * 40));
    const avif = await enc.avif(qA, 6, chroma);
    let fb = fbKind === 'png' ? await enc.png() : fbKind === 'webp' ? await enc.webp(qF) : await enc.jpeg(qF, chroma);
    let fbExt = fallbackExt, fbMime = fallbackMime;
    // Er originalen allerede i riktig størrelse og mindre, bruker vi den
    const origType = { jpeg: ['jpg', 'image/jpeg'], png: ['png', 'image/png'], webp: ['webp', 'image/webp'] }[meta.format];
    if (origType && w === srcW && (meta.orientation || 1) === 1 && bytes.length < fb.length) {
      fb = bytes; fbExt = origType[0]; fbMime = origType[1];
    }
    files.push({ kind: 'avif', w, h: raw.info.height, name: stem + '-' + w + '.avif', mime: 'image/avif', buffer: avif });
    files.push({ kind: 'fallback', w, h: raw.info.height, name: stem + '-' + w + '.' + fbExt, mime: fbMime, buffer: fb });
  }
  const top = files[files.length - 1];
  return {
    files, fallbackMime,
    width: top.w, height: top.h, alpha, graphic,
    quality: { avif: qA, fallback: qF, ssimTarget: +target.toFixed(4) },
    origBytes: bytes.length,
  };
}

module.exports = { optimizeImage, OPTIMIZABLE, _ssim: ssim };

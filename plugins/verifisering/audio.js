// Faktisk Studio · Verifisering — lyd og leppesynk
//
// analyze(channels, sampleRate, fps):
//   - stereo eller dobbel mono (korrelasjon venstre/høyre, sidesignal)
//   - bakgrunnsstøy i pausene (stilleste 8 % av 20 ms-rammer) og digital stillhet
//   - klipping, og brå sprang i lydsamplene (mulige skjøter)
//   - lydstyrke i talebåndet per videobilde (til leppesynk)
// lipsync(mouth, env, fps): krysskorrelasjon munnbevegelse ↔ tale, med tilfeldig
//   forskjøvet lyd som sammenligningsgrunnlag.
//
// Ren JS på Float32Array, så den kan testes i Node. Ingen dom — bare målinger.

(function (root) {
  'use strict';

  const db = x => 20 * Math.log10(Math.max(1e-9, x));

  // Énpols høypass + lavpass ≈ talebånd 300–3000 Hz
  function speechBand(x, sr) {
    const out = new Float32Array(x.length);
    const aH = Math.exp(-2 * Math.PI * 300 / sr), aL = Math.exp(-2 * Math.PI * 3000 / sr);
    let hp = 0, prev = 0, lp = 0;
    for (let i = 0; i < x.length; i++) {
      hp = aH * (hp + x[i] - prev); prev = x[i];
      lp = (1 - aL) * hp + aL * lp; out[i] = lp;
    }
    return out;
  }

  // opts.offset (s): når lydsamplene skal vises i forhold til bildet (fra MP4-ens
  // redigeringsliste). Talebånd-kurven per bilde regnes i bildets tidslinje.
  function analyze(channels, sr, fps, opts) {
    const offset = (opts && opts.offset) || 0;
    const L = channels[0], R = channels[1] || null; const n = L.length;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = R ? (L[i] + R[i]) / 2 : L[i];
    const res = { channels: channels.length, sampleRate: sr, duration: n / sr };

    if (R) {
      let sLL = 0, sRR = 0, sLR = 0, sD = 0;
      for (let i = 0; i < n; i++) { sLL += L[i] * L[i]; sRR += R[i] * R[i]; sLR += L[i] * R[i]; const d = L[i] - R[i]; sD += d * d; }
      res.stereoCorr = sLR / Math.sqrt(sLL * sRR || 1);
      res.sideRatio = Math.sqrt(sD / n) / Math.sqrt(sLL / n || 1e-12);
      res.dualMono = res.sideRatio < 0.01;
    }

    // 20 ms-rammer
    const hop = Math.round(sr * 0.02); const frames = Math.floor(n / hop); const rms = new Float32Array(frames);
    for (let f = 0; f < frames; f++) { let s = 0; for (let i = f * hop; i < (f + 1) * hop; i++) s += mono[i] * mono[i]; rms[f] = Math.sqrt(s / hop); }
    const sorted = Array.from(rms).sort((a, b) => a - b);
    const pct = q => db(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] || 0);
    res.loudDb = pct(0.9); res.medianDb = pct(0.5); res.quietDb = pct(0.05);
    res.noiseFloorDb = db(sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.08))).reduce((a, b) => a + b, 0) / Math.max(1, Math.floor(sorted.length * 0.08)));
    // digital stillhet: rammer under −90 dBFS
    let silent = 0, run = 0, longest = 0;
    for (const v of rms) { if (db(v) < -90) { silent++; run++; longest = Math.max(longest, run); } else run = 0; }
    res.digitalSilenceShare = frames ? silent / frames : 0; res.longestSilenceS = longest * 0.02;
    // klipping
    let clip = 0; for (let i = 0; i < n; i++) if (Math.abs(mono[i]) >= 0.999) clip++;
    res.clippedShare = clip / n;
    // brå sprang (mulige skjøter): differanse langt over det normale, i ellers rolige partier
    let dmax = 0; const diffs = new Float32Array(Math.floor(n / 4));
    for (let i = 4, j = 0; i < n && j < diffs.length; i += 4, j++) { const d = Math.abs(mono[i] - mono[i - 1]); diffs[j] = d; if (d > dmax) dmax = d; }
    const ds = Array.from(diffs).sort((a, b) => a - b); const p999 = ds[Math.floor(ds.length * 0.9999)] || 0;
    const jumps = [];
    for (let i = 1; i < n; i++) {
      const d = Math.abs(mono[i] - mono[i - 1]);
      if (d > Math.max(0.25, p999 * 1.5)) {
        const f = Math.floor(i / hop); const around = Math.max(rms[f - 2] || 0, rms[f + 2] || 0);
        if (db(around) < res.medianDb - 6) { const t = i / sr; if (!jumps.length || t - jumps[jumps.length - 1] > 0.5) jumps.push(t); }
      }
      if (jumps.length > 20) break;
    }
    res.jumps = jumps;

    // talebånd-lydstyrke per videobilde
    if (fps) {
      const sb = speechBand(mono, sr); const per = sr / fps; const nf = Math.floor((n / sr + offset) * fps);
      const env = new Float32Array(Math.max(0, nf));
      for (let k = 0; k < nf; k++) {
        const a = Math.floor((k / fps - offset) * sr), b = Math.floor(((k + 1) / fps - offset) * sr);
        if (b <= 0 || a >= n) { env[k] = -120; continue; }
        let s = 0; for (let i = Math.max(0, a); i < Math.min(n, b); i++) s += sb[i] * sb[i]; env[k] = db(Math.sqrt(s / Math.max(1, b - a)));
      }
      res.offset = offset;
      res.envelope = env;
    }
    return res;
  }

  function z(v) { let m = 0; for (const x of v) m += x; m /= v.length; let s = 0; for (const x of v) s += (x - m) * (x - m); s = Math.sqrt(s / v.length) || 1; return Float32Array.from(v, x => (x - m) / s); }
  function corrAt(a, b, lag) {
    // lag < 0: munnen kommer før lyden (a[t] mot b[t − lag])
    let s = 0, n = 0;
    for (let t = 0; t < a.length; t++) { const u = t - lag; if (u < 0 || u >= b.length) continue; s += a[t] * b[u]; n++; }
    return n ? s / n : 0;
  }
  // mouth[k] = munnbevegelse mellom bilde k og k+1; env[k] = tale i bilde k
  // Trekk fra glidende snitt (≈ ±0,125 s): beholder stavelsesrytmen og fjerner
  // langsomme endringer som ellers gir høy tilfeldig korrelasjon (målt på
  // referanseklippet: r 0,31 → 0,48, mens tilfeldig nivå sank fra 0,27 til 0,20).
  function detrend(x, w) {
    const out = new Float32Array(x.length); let s = 0, a = 0, b = -1;
    for (let i = 0; i < x.length; i++) {
      const lo = Math.max(0, i - w), hi = Math.min(x.length - 1, i + w);
      while (b < hi) s += x[++b]; while (a < lo) s -= x[a++];
      out[i] = x[i] - s / (b - a + 1);
    }
    return out;
  }
  function lipsync(mouth, env, fps, maxLag) {
    maxLag = maxLag || Math.round(fps * 0.5);
    const n = Math.min(mouth.length, env.length); if (n < fps * 4) return { error: 'For kort utsnitt (trenger minst 4 s)' };
    const fin = v => Float32Array.from(v, x => (isFinite(x) ? x : -100));
    const w = Math.max(2, Math.round(fps * 0.125));
    mouth = detrend(fin(mouth.slice(0, n)), w); env = detrend(fin(env.slice(0, n)), w);
    const a = z(mouth), b = z(env);
    const curve = []; for (let L = -maxLag; L <= maxLag; L++) curve.push({ lag: L, r: corrAt(a, b, L) });
    const best = curve.reduce((p, c) => (c.r > p.r ? c : p));
    // sammenligning: lyden forskjøvet tilfeldig minst 2 s
    // Vi velger den BESTE forskyvningen, så sammenligningen må også gjøre det:
    // for hver tilfeldig forskjøvet lyd tar vi den høyeste r innenfor samme vindu.
    const base = []; let seed = 12345;
    for (let i = 0; i < 120; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648; const sh = Math.floor(fps * 2 + (seed / 2147483648) * (n - fps * 4));
      const bb = new Float32Array(n); for (let t = 0; t < n; t++) bb[t] = b[(t + sh) % n];
      let m = -1; for (let L = -maxLag; L <= maxLag; L++) { const r = corrAt(a, bb, L); if (r > m) m = r; } base.push(m);
    }
    base.sort((x, y) => x - y);
    // stabilitet: beste forskyvning i 4 s-vinduer
    const win = Math.round(fps * 4), step = Math.round(fps * 2), windows = [];
    for (let s = 0; s + win <= n; s += step) {
      const aw = z(mouth.slice(s, s + win)), bw = z(env.slice(s, s + win)); let bl = 0, br = -1;
      for (let L = -maxLag; L <= maxLag; L++) { const r = corrAt(aw, bw, L); if (r > br) { br = r; bl = L; } }
      windows.push({ t: s / fps, lag: bl, r: br });
    }
    return { curve, best, lagMs: best.lag * 1000 / fps, base95: base[Math.floor(base.length * 0.95)], baseMean: base.reduce((x, y) => x + y, 0) / base.length, windows, frames: n };
  }

  const api = { analyze, lipsync, speechBand, detrend };
  root.VfAudio = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

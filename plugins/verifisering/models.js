// Faktisk Studio · Verifisering — modellfiler for leppesynk
//
// MediaPipe Face Landmarker trenger tre filer (ca. 13 MB) som er for store til å
// ligge i plugin-bundelen. De lastes ned ÉN gang etter samtykke, kontrolleres mot
// sha256 og lagres i plugin-vinduets IndexedDB. Deretter virker alt uten nett.
// Bare programfiler lastes NED — ingenting fra fila som analyseres sendes noe sted.
//
// Bytt versjon: oppdater URL + sha256 her og connect-src i index.html.

(function (root) {
  'use strict';

  const FILES = {
    loader: { url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.js', sha256: '4a97e2520ba506c680ecd6ba6acfb146888afa0e2746d57f205352bc6ebb82eb', type: 'text/javascript', mb: 0.2 },
    wasm: { url: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm/vision_wasm_internal.wasm', sha256: 'f00ec4731faa23b3e714d00e88d4d10e2df5c0a427d3a2b4ae6e3526fdd14ef7', type: 'application/wasm', mb: 9.6 },
    model: { url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', type: 'application/octet-stream', mb: 3.8 },
    // Personmaske til parallakse (bakgrunnen skal måles uten personen)
    selfie: { url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite', sha256: '191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b', type: 'application/octet-stream', mb: 0.25 },
  };
  const DB = 'faktisk-verifisering', STORE = 'filer';

  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function get(key) { const d = await db(); return new Promise((res, rej) => { const q = d.transaction(STORE).objectStore(STORE).get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error); }); }
  async function put(key, val) { const d = await db(); return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  async function sha(buf) { const h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join(''); }

  async function status() {
    for (const k of Object.keys(FILES)) { const v = await get(k); if (!v || v.sha256 !== FILES[k].sha256) return { ready: false, mb: Object.values(FILES).reduce((a, f) => a + f.mb, 0) }; }
    return { ready: true };
  }
  async function ensure(onProgress) {
    const keys = Object.keys(FILES); let i = 0;
    for (const k of keys) {
      const f = FILES[k]; const have = await get(k);
      if (!have || have.sha256 !== f.sha256) {
        if (onProgress) onProgress(i / keys.length, 'Laster ned ' + k + ' (' + f.mb.toString().replace('.', ',') + ' MB)…');
        const r = await fetch(f.url, { credentials: 'omit', cache: 'no-store' });
        if (!r.ok) throw new Error('Nedlasting feilet (' + r.status + ') for ' + f.url);
        const buf = await r.arrayBuffer(); const h = await sha(buf);
        if (h !== f.sha256) throw new Error('Feil sjekksum for ' + k + ' — fila er ikke lagret');
        await put(k, { sha256: h, buf, type: f.type, saved: Date.now() });
      }
      i++;
    }
    if (onProgress) onProgress(1, 'Klar');
  }
  let landmarker = null;
  async function faceLandmarker() {
    if (landmarker) return landmarker;
    const [ldr, wasm, model] = await Promise.all(['loader', 'wasm', 'model'].map(get));
    if (!ldr || !wasm || !model) throw new Error('Modellfilene mangler');
    const fileset = {
      wasmLoaderPath: URL.createObjectURL(new Blob([ldr.buf], { type: 'text/javascript' })),
      wasmBinaryPath: URL.createObjectURL(new Blob([wasm.buf], { type: 'application/wasm' })),
    };
    landmarker = await root.MPVision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(model.buf), delegate: 'CPU' },
      runningMode: 'VIDEO', numFaces: 1,
    });
    return landmarker;
  }

  let segmenter = null;
  async function selfieSegmenter() {
    if (segmenter) return segmenter;
    const [ldr, wasm, model] = await Promise.all(['loader', 'wasm', 'selfie'].map(get));
    if (!ldr || !wasm || !model) throw new Error('Modellfilene mangler');
    const fileset = { wasmLoaderPath: URL.createObjectURL(new Blob([ldr.buf], { type: 'text/javascript' })), wasmBinaryPath: URL.createObjectURL(new Blob([wasm.buf], { type: 'application/wasm' })) };
    segmenter = await root.MPVision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: new Uint8Array(model.buf), delegate: 'CPU' },
      runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
    });
    return segmenter;
  }
  // Personmaske (1 = person) for et canvas, i canvasets oppløsning
  async function personMask(canvas) {
    const seg = await selfieSegmenter();
    const r = seg.segment(canvas);
    const m = r.confidenceMasks[0]; const w = m.width, h = m.height; const f = m.getAsFloat32Array();
    const out = new Uint8Array(canvas.width * canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const v = f[Math.min(h - 1, Math.floor(y * h / canvas.height)) * w + Math.min(w - 1, Math.floor(x * w / canvas.width))];
      out[y * canvas.width + x] = v > 0.35 ? 1 : 0;
    }
    if (r.close) r.close(); else m.close && m.close();
    return out;
  }

  root.VfModels = { FILES, status, ensure, faceLandmarker, personMask };
})(typeof window !== 'undefined' ? window : globalThis);

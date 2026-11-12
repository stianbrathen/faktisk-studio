// Faktisk Studio · eksport av HTML-embed (f.eks. Chatbobler) som video
//
// Embed-koden lastes i et usynlig vindu (offscreen rendering) med en
// virtuell klokke (dom-video-harness.js). For hver ramme flyttes klokka
// fram, Chromium tegner, og bildet (PNG med alfa) sendes til ffmpeg.
//
// Formater:
//   mp4         H.264, ugjennomsiktig bakgrunn (til SoMe/video)
//   prores      ProRes 4444 .mov med alfa (redigering: Premiere, Final Cut, Resolve)
//   hevc-alpha  HEVC med alfa .mov (mindre fil; Apple-programmer, Keynote, iMovie)

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { HARNESS } = require('./dom-video-harness');

function buildPage({ html, width, background, padding }) {
  const bg = background === 'transparent' ? 'transparent' : (background || '#FFFFFF');
  const pad = Math.max(0, Math.round(padding || 0));
  return '<!doctype html><html lang="nb"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<style>html,body{margin:0;padding:0;background:' + bg + ';overflow:hidden;}'
    + '#fk-stage{box-sizing:border-box;width:' + Math.round(width + pad * 2) + 'px;padding:' + pad + 'px;}'
    + '#fk-stage::after{content:"";display:table;clear:both;}</style>'
    + '<script>' + HARNESS + '<\/script>'
    + '</head><body><div id="fk-stage">' + html + '</div></body></html>';
}

function ffmpegArgs(format, fps, savePath, W, H) {
  const input = ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-'];
  if (format === 'prores') {
    // Apples egen ProRes-koder (VideoToolbox). ffmpegs prores_ks ga filer med
    // alfakanal som Final Cut ikke viste som gjennomsiktige. Fargeinfo settes
    // eksplisitt (BT.709) slik Apples egne eksporter gjør.
    return [...input, '-c:v', 'prores_videotoolbox', '-profile:v', '4444', '-allow_sw', '1',
      '-pix_fmt', 'bgra',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
      '-y', savePath];
  }
  if (format === 'hevc-alpha') {
    const kbps = Math.round((W * H * fps * 0.25) / 1000);
    return [...input, '-c:v', 'hevc_videotoolbox', '-alpha_quality', '1.0', '-pix_fmt', 'bgra',
      '-tag:v', 'hvc1', '-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.5) + 'k',
      '-bufsize', Math.round(kbps * 2) + 'k', '-g', String(fps), '-realtime', '0',
      '-movflags', '+faststart', '-y', savePath];
  }
  // mp4: H.264 med høy kvalitet (skarpe kanter på tekst og bobler)
  return [...input, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-tune', 'animation',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', savePath];
}

/**
 * @param {object} o
 *   html, width (CSS px), scale (1–4), fps, durationMs, background ('transparent' | farge),
 *   padding (CSS px), format ('mp4'|'prores'|'hevc-alpha'), savePath
 * @param {object} env  { BrowserWindow, ffmpegPath, onProgress, isCancelled }
 */
async function exportDomVideo(o, env) {
  const { BrowserWindow, ffmpegPath } = env;
  const onProgress = env.onProgress || (() => {});
  const isCancelled = env.isCancelled || (() => false);
  const fps = Math.max(10, Math.min(60, Math.round(o.fps || 30)));
  const scale = Math.max(1, Math.min(4, +o.scale || 2));
  const width = Math.max(200, Math.min(1400, Math.round(o.width || 390)));
  const padding = o.padding == null ? 16 : +o.padding;
  const transparentOut = o.format === 'prores' || o.format === 'hevc-alpha';
  const background = transparentOut ? 'transparent'
    : (o.background && o.background !== 'transparent' ? o.background : '#FFFFFF');
  const frames = Math.max(1, Math.ceil((Math.max(500, +o.durationMs || 0) / 1000) * fps));

  const tmp = path.join(os.tmpdir(), 'faktisk-domvideo-' + Date.now() + '.html');
  fs.writeFileSync(tmp, buildPage({ html: o.html, width, background, padding }));

  const pageW = width + padding * 2;
  const win = new BrowserWindow({
    show: false, frame: false, transparent: true, backgroundColor: '#00000000',
    width: Math.round(pageW * scale), height: Math.round(1600 * scale),
    useContentSize: true, enableLargerThanScreen: true,
    webPreferences: {
      offscreen: true, partition: 'faktisk-domvideo', backgroundThrottling: false,
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const wc = win.webContents;
  wc.setFrameRate(60);

  let latest = null, waiters = [];
  wc.on('paint', (e, dirty, image) => {
    latest = image;
    const w = waiters; waiters = [];
    w.forEach(r => r(image));
  });
  const nextPaint = () => new Promise(res => {
    const timer = setTimeout(() => res(latest), 1500);
    waiters.push(img => { clearTimeout(timer); res(img); });
    wc.invalidate();
  });

  let ff = null;
  try {
    onProgress({ phase: 'loading', percent: 0 });
    await win.loadFile(tmp);
    wc.setZoomFactor(scale);
    await new Promise(r => setTimeout(r, 80));
    // Sørg for at siden ser riktig bredde i CSS-piksler (offscreen-vinduer
    // kan ha en annen skjermskala enn forventet)
    const vp = await wc.executeJavaScript('({ iw: window.innerWidth, dpr: window.devicePixelRatio })', true);
    if (vp && vp.iw && Math.abs(vp.iw - pageW) > 1) {
      wc.setZoomFactor(scale * vp.iw / pageW);
      await new Promise(r => setTimeout(r, 80));
    }
    await wc.executeJavaScript('window.__fkVT.ready()', true);
    await wc.executeJavaScript('window.__fkVT.step(0)', true);

    // Mål innholdet og gjør vinduet akkurat så stort (partall for videokodek)
    const size = await wc.executeJavaScript('window.__fkVT.size()', true);
    const W = Math.round(pageW * scale / 2) * 2;
    const H = Math.max(2, Math.round(Math.ceil(size.h) * scale / 2) * 2);
    win.setContentSize(W, H);
    await new Promise(r => setTimeout(r, 120));
    await wc.executeJavaScript('window.__fkVT.step(0)', true);

    ff = spawn(ffmpegPath, ffmpegArgs(o.format, fps, o.savePath, W, H));
    let stderr = '';
    ff.stderr.on('data', c => { stderr += c.toString(); if (stderr.length > 20000) stderr = stderr.slice(-8000); });
    const ffDone = new Promise((resolve, reject) => {
      ff.on('error', err => reject(new Error('ffmpeg-prosessfeil: ' + err.message)));
      ff.on('close', code => code === 0 ? resolve()
        : reject(new Error('ffmpeg feilet (kode ' + code + '): ' + stderr.split('\n').slice(-4).join(' | '))));
    });
    ffDone.catch(() => {});
    const write = buf => new Promise((res, rej) => {
      if (!ff.stdin.writable) return rej(new Error('ffmpeg stoppet'));
      ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res);
    });

    for (let i = 0; i < frames; i++) {
      if (isCancelled()) throw new Error('Avbrutt');
      await wc.executeJavaScript('window.__fkVT.step(' + (i * 1000 / fps) + ')', true);
      const img = await nextPaint();
      if (!img) throw new Error('Fikk ikke tegnet ramme ' + (i + 1));
      let png = img;
      const s = img.getSize();
      if (s.width !== W || s.height !== H) {
        // Annen pikseltetthet enn bestilt: skaler hele bildet, kapp ev. høyden
        const k = W / s.width;
        png = img.resize({ width: W, height: Math.round(s.height * k), quality: 'best' });
        const ps = png.getSize();
        if (ps.height !== H) png = png.crop({ x: 0, y: 0, width: W, height: Math.min(H, ps.height) });
        if (png.getSize().height !== H) png = png.resize({ width: W, height: H, quality: 'best' });
      }
      await write(png.toPNG());
      if (i % 5 === 0) onProgress({ phase: 'rendering', percent: Math.round((i + 1) / frames * 100), frame: i + 1, frames });
    }
    ff.stdin.end();
    onProgress({ phase: 'encoding', percent: 100 });
    await ffDone;
    let sizeMB = null;
    try { sizeMB = (fs.statSync(o.savePath).size / 1048576).toFixed(1); } catch (e) {}
    onProgress({ phase: 'done', percent: 100 });
    return { ok: true, savePath: o.savePath, sizeMB, width: W, height: H, frames, fps };
  } catch (err) {
    if (ff) { try { ff.stdin.destroy(); ff.kill('SIGKILL'); } catch (e) {} }
    try { if (o.savePath && fs.existsSync(o.savePath)) fs.unlinkSync(o.savePath); } catch (e) {}
    return { ok: false, error: err.message };
  } finally {
    try { win.destroy(); } catch (e) {}
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}

module.exports = { exportDomVideo, buildPage, ffmpegArgs };

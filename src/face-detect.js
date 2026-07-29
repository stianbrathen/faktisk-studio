// Faktisk Studio — ansiktsdeteksjon med UltraFace (RFB-640, ~1,4 MB ONNX)
//
// Modell: Ultra-Light-Fast-Generic-Face-Detector-1MB (MIT-lisens), kjøres
// lokalt via onnxruntime-node. Ingen nettverkskall under kjøring — modellen
// lastes ned én gang til userData/models/ av modell-nedlasteren i main.js.
//
// Input:  rå RGB24-frame på nøyaktig 640×480 (letterbokses av ffmpeg).
// Output: ansiktsbokser normalisert 0–1 relativt til 640×480-rammen.

'use strict';

const MODEL_W = 640;
const MODEL_H = 480;

let ort = null;
function getOrt() {
  if (!ort) ort = require('onnxruntime-node');
  return ort;
}

async function createSession(modelPath) {
  return getOrt().InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
}

// RGB24 (Buffer, HWC) → Float32 CHW normalisert (x-127)/128
function prepInput(rgb) {
  const n = MODEL_W * MODEL_H;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = (rgb[i * 3] - 127) / 128;             // R
    out[n + i] = (rgb[i * 3 + 1] - 127) / 128;     // G
    out[2 * n + i] = (rgb[i * 3 + 2] - 127) / 128; // B
  }
  return out;
}

function iou(a, b) {
  const x1 = Math.max(a.x1, b.x1), y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2), y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter + 1e-9);
}

function nms(dets, iouThresh) {
  dets.sort((a, b) => b.conf - a.conf);
  const kept = [];
  for (const d of dets) {
    if (kept.every(k => iou(k, d) < iouThresh)) kept.push(d);
  }
  return kept;
}

/**
 * Kjør deteksjon på én 640×480 RGB24-frame.
 * @returns Array<{x1,y1,x2,y2,conf}> — normaliserte hjørnekoordinater, NMS-et
 */
async function detectFaces(session, rgb, opts) {
  const o = Object.assign({ confThresh: 0.6, iouThresh: 0.4, maxDets: 24 }, opts || {});
  const OrtNS = getOrt();
  const input = new OrtNS.Tensor('float32', prepInput(rgb), [1, 3, MODEL_H, MODEL_W]);
  const res = await session.run({ [session.inputNames[0]]: input });
  const scores = res.scores.data;   // [1, N, 2] — [bakgrunn, ansikt]
  const boxes = res.boxes.data;     // [1, N, 4] — x1,y1,x2,y2 normalisert
  const N = scores.length / 2;

  const dets = [];
  for (let i = 0; i < N; i++) {
    const conf = scores[i * 2 + 1];
    if (conf < o.confThresh) continue;
    dets.push({
      x1: boxes[i * 4], y1: boxes[i * 4 + 1],
      x2: boxes[i * 4 + 2], y2: boxes[i * 4 + 3],
      conf,
    });
  }
  return nms(dets, o.iouThresh).slice(0, o.maxDets);
}

module.exports = { createSession, detectFaces, MODEL_W, MODEL_H, iou };

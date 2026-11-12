#!/usr/bin/env node
// Test transkriberingsflyten fra Terminal — uten å bygge eller starte Studio.
// Bruker samme whisper-cli og modeller som Studio har lastet ned.
//
//   node scripts/test-transcribe.js <video-eller-lydfil> [valg]
//
// Valg:
//   --modell small|medium|large   (standard: large = NB-Whisper large)
//   --vad1 0.2                    kjør pass 1 MED VAD (slik Studio gjorde før 30.10.2026)
//   --uten-norm                   ikke lydnormalisering (dynaudnorm)
//   --med-prompt                  send Faktisk-ordlista som hint (av som standard fra 30.10.2026)
//   --ut <fil.srt>                skriv resultatet som SRT (standard: ved siden av klippet)
//
// Skriver hva pass 1 fant, hvert hull og hva hull-passet tok med, og til slutt SRT.
const fs = require('fs');
const os = require('os');
const path = require('path');
const tp = require('../src/transcribe-pipeline.js');

const args = process.argv.slice(2);
const flag = n => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const input = args.find(a => !a.startsWith('--') && !['--modell', '--vad1', '--ut'].includes(args[args.indexOf(a) - 1]));
if (!input || !fs.existsSync(input)) {
  console.error('Bruk: node scripts/test-transcribe.js <video-eller-lydfil> [--modell large] [--vad1 0.2] [--uten-norm] [--med-prompt]');
  process.exit(1);
}

const U = path.join(os.homedir(), 'Library', 'Application Support', 'Faktisk Studio');
const MODELS = { small: 'ggml-nb-whisper-small-q5.bin', medium: 'ggml-nb-whisper-medium-q5.bin', large: 'ggml-nb-whisper-large-q5.bin' };
const model = path.join(U, 'models', MODELS[val('--modell', 'large')] || MODELS.large);
const vadModel = path.join(U, 'models', 'ggml-silero-v5.1.2.bin');
let cli = path.join(U, 'bin', 'whisper-cli');
if (!fs.existsSync(cli)) cli = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'].find(p => fs.existsSync(p));
let ffmpeg = 'ffmpeg';
try { ffmpeg = require('ffmpeg-static') || 'ffmpeg'; } catch (e) {}
for (const [navn, p] of [['whisper-cli', cli], ['modell', model], ['VAD-modell', vadModel]]) {
  if (!p || !fs.existsSync(p)) { console.error('Mangler ' + navn + ': ' + p + ' (transkriber én gang i Studio først)'); process.exit(1); }
}

const fmt = t => {
  const ms = Math.round(t * 1000);
  const p = (n, w) => String(n).padStart(w, '0');
  return p(Math.floor(ms / 3600000), 2) + ':' + p(Math.floor(ms / 60000) % 60, 2) + ':'
    + p(Math.floor(ms / 1000) % 60, 2) + ',' + p(ms % 1000, 3);
};

(async () => {
  const tmp = path.join(os.tmpdir(), 'faktisk-test-' + Date.now());
  const wav = tmp + '.wav';
  const t0 = Date.now();
  try {
    await tp.extractAudioWav(ffmpeg, input, wav, { normalize: !flag('--uten-norm') });
    const segs = await tp.transcribeWav({
      cli, ffmpeg, wav, model, vadModel, lang: 'no',
      prompt: 'Faktisk.no, Faktisk, faktasjekk', usePrompt: flag('--med-prompt'),
      pass1Vad: val('--vad1', null),
      tmpPrefix: tmp,
      debug: s => console.log(s),
    });
    const srt = segs.map((s, i) => (i + 1) + '\n' + fmt(s.start) + ' --> ' + fmt(s.end) + '\n' + s.text + '\n').join('\n');
    console.log('\nRESULTAT (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s):\n');
    console.log(srt);
    const out = val('--ut', input.replace(/\.[^./]+$/, '') + '.test.srt');
    fs.writeFileSync(out, srt);
    console.log('Lagret: ' + out);
  } catch (e) {
    console.error('FEIL: ' + e.message);
    process.exitCode = 1;
  } finally {
    try { fs.unlinkSync(wav); } catch (e) {}
  }
})();

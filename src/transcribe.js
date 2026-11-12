// UTGÅTT — kan slettes.
//
// Transkribering skjer nå via whisper.cpp-binæren, spawnet fra main.js
// (samme mønster som ffmpeg). Denne transformers.js-baserte varianten er
// forlatt fordi onnxruntime krasjer i alle Electron-prosesstyper når
// Whisper-store tensorer allokeres (BFCArena::Extend → SIGTRAP i Electrons
// minne-hooks, bekreftet i krasjrapporter for både ORT 1.21 og 1.27).

// MediaPipe Face Detector 모델 다운로드 (npm install 시 자동 실행)
const fs = require('fs');
const path = require('path');
const https = require('https');

const URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';
const OUT_DIR = path.join(__dirname, '..', 'assets', 'mediapipe', 'models');
const OUT_FILE = path.join(OUT_DIR, 'face_detector.tflite');

if (fs.existsSync(OUT_FILE) && fs.statSync(OUT_FILE).size > 100000) {
  console.log('[JJUUK] model already present:', OUT_FILE);
  process.exit(0);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log('[JJUUK] downloading face detector model...');

function get(url, file) {
  https
    .get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, file);
      }
      if (res.statusCode !== 200) {
        console.error('[JJUUK] model download failed:', res.statusCode);
        process.exit(1);
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        console.log('[JJUUK] model saved →', OUT_FILE);
      });
    })
    .on('error', (e) => {
      console.error('[JJUUK] model download error:', e.message);
      process.exit(1);
    });
}

get(URL, fs.createWriteStream(OUT_FILE));

// 웹캠 → MediaPipe FaceDetector → baseline 대비 변화량 계산 → IPC로 상태 송신
import {
  FaceDetector,
  FilesetResolver,
} from '../../node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';

const MODEL_URL  = '../../assets/mediapipe/models/face_detector.tflite';
const WASM_BASE  = '../../node_modules/@mediapipe/tasks-vision/wasm';

const DEBOUNCE_MS = 700;
const RECOVERY_RATIO = 0.9;
const MEASURE_MS = 3000;
// 캘리브레이션 성공으로 인정하는 in-guide 프레임 최소 비율
const CALIB_VALID_RATIO = 0.7;
// bad → good 복귀 직후 다른 캐릭터가 곧바로 튀어나오지 않게 막는 쿨다운
const RECOVERY_COOLDOWN_MS = 3000;

let detector = null;
let video = null;

// DOM
let titleEl, statusEl, subMsgEl, subtitleEl, startBtn, retakeBtn, confirmBtn, progressFill, faceGuide, frozenCanvas;

const TITLE_DEFAULT      = '바른 자세를 기억해 둘게요';
const TITLE_DONE         = '측정이 끝났어요';
const SUBTITLE_DEFAULT   = '박스 안에 얼굴이 들어오도록 편하게 앉아주세요';
const SUBTITLE_MEASURING = '잠깐, 이 자세 그대로 유지해주세요';
const SUBTITLE_DONE      = '이 자세를 기준으로 알려드릴게요';

// 모니터링용
let isActive = true;
let threshold = { faceWidthRatio: 1.15, faceYDelta: 0.05 };
let baseline = null;

// 캘리브레이션 진행 상태
let calibBuffer = [];
let calibInProgress = false;
let calibStartedAt = 0;
let calibFrameCount = 0;     // 측정 중 흘러간 총 프레임 수
let calibInGuideCount = 0;   // 측정 중 얼굴이 가이드 박스 안에 있었던 프레임 수
let lastInGuide = false;     // 마지막 프레임에서 얼굴이 가이드 박스 안에 있었는지
let guideLocked = false;     // freeze 이후 가이드 박스 색을 실시간으로 갱신하지 않도록 잠금

// 상태 머신
// 'init' | 'ready' | 'measuring' | 'done' | 'invalid'
let phase = 'init';

// posture 감지용
let lastState = 'good';
let pendingState = 'good';
let pendingSince = 0;
let cooldownUntil = 0;

function setStatus(text, cls = '') {
  statusEl.textContent = text;
  statusEl.className = cls;
}
function setSubMsg(text, variant = '') {
  subMsgEl.textContent = text || '';
  subMsgEl.classList.remove('success', 'warning');
  if (variant) subMsgEl.classList.add(variant);
}
function setProgressVariant(warning) {
  progressFill.classList.toggle('warning', !!warning);
}
function setSubtitle(text, variant = '') {
  if (!subtitleEl) return;
  subtitleEl.textContent = text;
  subtitleEl.classList.remove('success', 'warning');
  if (variant) subtitleEl.classList.add(variant);
}
function setTitle(text) {
  if (titleEl) titleEl.textContent = text;
}
function setProgress(p) {
  progressFill.style.width = (Math.max(0, Math.min(1, p)) * 100) + '%';
}

// 얼굴이 정사각 가이드 (중앙, 폭 28%) 안에 적정 크기로 들어왔는지 판정.
// 가이드 박스는 CSS 에서 width:28% × aspect-ratio:1/1 → 16:9 preview 에서 세로 범위가
// 0.5 ± (0.28 * 16/9 / 2) ≈ 0.5 ± 0.249 = 0.251~0.749. 시각 박스와 일치하도록 cy 범위 조정.
function isInGuide(box) {
  const cx = (box.originX + box.width / 2) / video.videoWidth;
  const cy = (box.originY + box.height / 2) / video.videoHeight;
  const w  = box.width / video.videoWidth;
  return cx > 0.36 && cx < 0.64 && cy > 0.25 && cy < 0.75 && w > 0.14 && w < 0.30;
}

// 현재 phase 에 맞춰 버튼/문구 세팅
function applyPhase(p) {
  phase = p;
  switch (p) {
    case 'init':
      setTitle(TITLE_DEFAULT);
      setSubtitle(SUBTITLE_DEFAULT);
      startBtn.hidden = false;
      startBtn.disabled = true;
      retakeBtn.hidden = true;
      retakeBtn.classList.remove('danger');
      confirmBtn.hidden = true;
      setSubMsg('');
      setProgressVariant(false);
      break;
    case 'ready':
      setTitle(TITLE_DEFAULT);
      setSubtitle(SUBTITLE_DEFAULT);
      startBtn.hidden = false;
      startBtn.disabled = false;
      retakeBtn.hidden = true;
      retakeBtn.classList.remove('danger');
      confirmBtn.hidden = true;
      setSubMsg('');
      setProgress(0);
      setProgressVariant(false);
      guideLocked = false;
      break;
    case 'measuring':
      setTitle(TITLE_DEFAULT);
      setSubtitle(SUBTITLE_MEASURING);
      startBtn.hidden = true;
      retakeBtn.hidden = true;
      retakeBtn.classList.remove('danger');
      confirmBtn.hidden = true;
      // 초기 sub-message: loop 에서 inGuide 여부에 따라 실시간으로 덮어씀
      setSubMsg('잘 인식되고 있어요!', 'success');
      setProgressVariant(false);
      break;
    case 'done':
      setTitle(TITLE_DONE);
      setSubtitle(SUBTITLE_DONE, 'success');
      startBtn.hidden = true;
      retakeBtn.hidden = false;
      retakeBtn.classList.remove('danger');
      confirmBtn.hidden = false;
      setSubMsg('');
      setProgressVariant(false);
      break;
    case 'invalid':
      // 박스 안에 얼굴이 충분히 머무르지 못했을 때 — baseline 저장하지 않고 재측정 유도
      setTitle('얼굴이 잘 안 보였어요');
      setSubtitle('박스 안에 얼굴이 들어오도록 자세를 잡고 다시 시도해 주세요', 'warning');
      startBtn.hidden = true;
      retakeBtn.hidden = false;
      retakeBtn.classList.add('danger');
      confirmBtn.hidden = true;
      setSubMsg('');
      setProgressVariant(true);
      break;
  }
}

async function init() {
  titleEl      = document.querySelector('.title');
  statusEl     = document.getElementById('status');
  subMsgEl     = document.getElementById('subMessage');
  subtitleEl   = document.querySelector('.subtitle');
  startBtn     = document.getElementById('startBtn');
  retakeBtn    = document.getElementById('retakeBtn');
  confirmBtn   = document.getElementById('confirmBtn');
  progressFill = document.getElementById('progressFill');
  faceGuide    = document.getElementById('faceGuide');
  frozenCanvas = document.getElementById('frozenFrame');

  startBtn.addEventListener('click', beginCalibration);
  retakeBtn.addEventListener('click', () => {
    showLiveFeed();
    beginCalibration();
  });
  confirmBtn.addEventListener('click', () => {
    window.jjuuk.notifyCalibDone();
    showLiveFeed();
    applyPhase('ready');
  });

  applyPhase('init');

  try {
    setStatus('얼굴 인식을 준비하는 중이에요…');
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    // 일부 Windows GPU 드라이버에서 GPU delegate 가 createFromOptions 는 통과하지만
    // 실제 detectForVideo 호출 시 조용히 빈 결과만 반환하는 케이스가 있어
    // GPU 가 실패하면 CPU 로 한번 더 시도한다.
    try {
      detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      });
    } catch (gpuErr) {
      console.warn('[JJUUK] GPU delegate failed, falling back to CPU:', gpuErr);
      detector = await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5,
      });
    }
  } catch (e) {
    console.error('[JJUUK] MediaPipe load failed', e);
    setStatus('얼굴 인식 준비에 실패했어요: ' + e.message, 'error');
    return;
  }

  video = document.getElementById('cam');

  // 일시정지 상태로 시작했다면 카메라를 굳이 켜지 않음
  if (isActive) {
    try {
      setStatus('카메라 연결 중이에요…');
      await startCamera();
    } catch (e) {
      console.error('[JJUUK] camera failed', e);
      setStatus('카메라 권한을 확인해주세요', 'error');
      return;
    }
  }

  // init 도중 main 으로부터 비활성 신호가 도착했다면 즉시 해제
  if (!isActive) stopCamera();

  applyPhase('ready');
  requestAnimationFrame(loop);
}

let cameraStarting = false;

async function startCamera() {
  if (video.srcObject || cameraStarting) return;
  cameraStarting = true;
  try {
    // ideal 로 지정 — 카메라가 720p 지원 안 하면 가까운 해상도로 fallback (강제 제약은 throw)
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
    };
    // 트랙 해제 직후 즉시 getUserMedia 하면 NotReadableError/AbortError 종종 발생 → 짧은 재시도
    let stream = null;
    let lastErr = null;
    for (let i = 0; i < 4; i++) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (e) {
        lastErr = e;
        console.warn('[JJUUK] getUserMedia attempt', i + 1, 'failed:', e.name);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    // ideal 도 실패하면 어떤 카메라든 받게 마지막 시도
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      } catch (e) {
        throw lastErr || e;
      }
    }

    video.srcObject = stream;
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
      });
    }
    try {
      await video.play();
    } catch (e) {
      // play() 가 interrupted 등으로 reject 돼도 srcObject 는 살아있어 재생은 이어짐
      console.warn('[JJUUK] video.play() warning:', e.message);
    }
  } finally {
    cameraStarting = false;
  }
}

function stopCamera() {
  if (!video?.srcObject) return;
  try { video.pause(); } catch {}
  video.srcObject.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}

function beginCalibration() {
  baseline = null;
  calibBuffer = [];
  calibFrameCount = 0;
  calibInGuideCount = 0;
  calibInProgress = true;
  calibStartedAt = performance.now();
  guideLocked = false;
  applyPhase('measuring');
  setStatus('측정 중이에요. 자세를 유지해주세요');
}

// 측정 종료 시점의 카메라 프레임을 캔버스로 동결 → 사용자가 자세 확인 후 다시 촬영 결정
function freezeFrame() {
  if (!video || !frozenCanvas) return;
  frozenCanvas.width = video.videoWidth || 1280;
  frozenCanvas.height = video.videoHeight || 720;
  const ctx = frozenCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, frozenCanvas.width, frozenCanvas.height);
  frozenCanvas.hidden = false;
  video.style.visibility = 'hidden';
}
function showLiveFeed() {
  if (!frozenCanvas || !video) return;
  frozenCanvas.hidden = true;
  video.style.visibility = '';
}

function finishCalibration() {
  calibInProgress = false;
  setProgress(1);
  freezeFrame();  // 마지막 프레임 잡아서 띄움
  guideLocked = true;  // 이후 가이드 박스 색은 실시간 감지에 따라 바뀌지 않도록 잠금

  // 얼굴이 가이드 박스 안에 충분히 머무르지 못했거나 마지막 프레임이 박스 밖이면 무효 처리
  const inGuideRatio = calibFrameCount > 0 ? calibInGuideCount / calibFrameCount : 0;
  if (calibBuffer.length === 0 || !lastInGuide || inGuideRatio < CALIB_VALID_RATIO) {
    // 무효 — 잠금된 가이드 박스를 빨간색으로 표시해 사용자에게 명확히 알림
    faceGuide.classList.remove('inside');
    faceGuide.classList.add('outside');
    applyPhase('invalid');
    setStatus('', '');
    return;
  }
  // 유효 — 잠금된 가이드 박스를 초록색으로 표시
  faceGuide.classList.remove('outside');
  faceGuide.classList.add('inside');

  const sum = calibBuffer.reduce(
    (a, m) => ({ faceWidth: a.faceWidth + m.faceWidth, faceY: a.faceY + m.faceY }),
    { faceWidth: 0, faceY: 0 }
  );
  baseline = {
    faceWidth: sum.faceWidth / calibBuffer.length,
    faceY: sum.faceY / calibBuffer.length,
  };
  window.jjuuk.saveBaseline(baseline);
  console.log('[JJUUK] baseline', baseline);
  applyPhase('done');
  setStatus('', '');   // done 메시지는 subtitle 이 대신함
}

function loop() {
  if (!detector || !video || !video.srcObject) {
    requestAnimationFrame(loop);
    return;
  }
  // 비디오가 첫 프레임을 받기 전이면 detectForVideo 가 throw — 다음 프레임까지 대기
  if (video.readyState < 2 || video.videoWidth === 0) {
    requestAnimationFrame(loop);
    return;
  }
  const ts = performance.now();
  let result;
  try {
    result = detector.detectForVideo(video, ts);
  } catch (err) {
    console.warn('[JJUUK] detectForVideo failed:', err);
    requestAnimationFrame(loop);
    return;
  }

  const inGuide =
    result.detections.length > 0 && isInGuide(result.detections[0].boundingBox);
  const outside = !inGuide;
  lastInGuide = inGuide;

  // 가이드 색 — 기본 회색, 안에 있으면 초록(inside), 밖이면 빨강(outside)
  // freeze 이후(guideLocked)에는 finishCalibration 이 결정한 색을 유지
  if (!guideLocked) {
    faceGuide.classList.toggle('inside', inGuide);
    faceGuide.classList.toggle('outside', outside);
  }

  // 상태 텍스트 — ready 일 때만 안내. 측정 중/카운트다운/done 은 applyPhase 가 관리.
  if (phase === 'ready') {
    if (outside) setStatus('얼굴을 박스 안에 맞춰주세요', 'outside');
    else         setStatus('', '');
  }

  // 측정 진행 중이면 샘플 누적 + 진행바 + 종료 체크
  if (calibInProgress) {
    const elapsed = ts - calibStartedAt;
    setProgress(elapsed / MEASURE_MS);
    // 박스 밖이면 진행바와 안내 문구를 즉시 경고색으로 — 사용자가 자세 조정 신호를 받음
    setProgressVariant(outside);
    if (outside) setSubMsg('얼굴이 박스에서 벗어났어요. 자세를 맞춰주세요', 'warning');
    else         setSubMsg('잘 인식되고 있어요!', 'success');
    calibFrameCount += 1;
    if (inGuide) calibInGuideCount += 1;
    // 박스 안에 있을 때만 baseline 샘플로 사용 — 박스 밖 자세는 기준점 오염
    if (inGuide && result.detections.length > 0) {
      const box = result.detections[0].boundingBox;
      calibBuffer.push({
        faceWidth: box.width / video.videoWidth,
        faceY: (box.originY + box.height / 2) / video.videoHeight,
      });
    }
    if (elapsed >= MEASURE_MS) finishCalibration();
  } else if (isActive && baseline && result.detections.length > 0) {
    const box = result.detections[0].boundingBox;
    evaluate({
      faceWidth: box.width / video.videoWidth,
      faceY: (box.originY + box.height / 2) / video.videoHeight,
    }, ts);
  }
  requestAnimationFrame(loop);
}

function evaluate(m, ts) {
  const widthRatio = m.faceWidth / baseline.faceWidth;
  const yDelta = m.faceY - baseline.faceY;

  let raw = 'good';
  if (widthRatio >= threshold.faceWidthRatio) raw = 'turtle-neck';
  else if (yDelta >= threshold.faceYDelta) raw = 'slouch';

  if (lastState !== 'good' && raw === 'good') {
    const recovered =
      widthRatio < threshold.faceWidthRatio * RECOVERY_RATIO &&
      yDelta < threshold.faceYDelta * RECOVERY_RATIO;
    if (!recovered) raw = lastState;
  }

  // (A) bad → 다른 bad 직접 전환 차단. 반드시 'good' 을 거쳐야 함
  if (lastState !== 'good' && raw !== 'good' && raw !== lastState) {
    raw = lastState;
  }

  // (B) 'good' 복귀 직후 쿨다운: bad 트리거를 일정 시간 무시
  if (ts < cooldownUntil && raw !== 'good') {
    raw = 'good';
  }

  if (raw !== pendingState) {
    pendingState = raw;
    pendingSince = ts;
  }
  if (pendingState !== lastState && ts - pendingSince >= DEBOUNCE_MS) {
    const prevState = lastState;
    lastState = pendingState;
    if (prevState !== 'good' && lastState === 'good') {
      cooldownUntil = ts + RECOVERY_COOLDOWN_MS;
    }
    window.jjuuk.sendPostureState(lastState);
    console.log('[JJUUK] state', lastState, 'w×', widthRatio.toFixed(2), 'Δy', yDelta.toFixed(3));
  }
}

window.jjuuk.onSetActive(async (v) => {
  isActive = v;
  if (!video) return; // init 아직 안 끝남 → init 끝에서 다시 체크
  if (v && !video.srcObject) {
    try {
      await startCamera();
    } catch (e) {
      console.error('[JJUUK] resume camera failed', e);
      return;
    }
    // 카메라 켜는 사이에 다시 일시정지 됐다면 즉시 다시 끄기
    if (!isActive) { stopCamera(); return; }
    // 일시정지 도중 lastState 가 stale (예: 'turtle-neck') 일 수 있고
    // 오버레이는 이미 'good' 으로 초기화됐기 때문에 상태 머신을 리셋한다.
    lastState = 'good';
    pendingState = 'good';
    pendingSince = performance.now();
    cooldownUntil = 0;
  } else if (!v && video.srcObject) {
    stopCamera();
  }
});
window.jjuuk.onCalibrate(() => {
  // 트레이/설정 → 자세 재측정. 창은 main 이 띄움, 우리는 ready 상태로 초기화.
  // 이전 측정에서 freeze 된 프레임이 남아있을 수 있어 라이브 피드로 먼저 복귀.
  if (!detector || !video) return;
  showLiveFeed();
  applyPhase('ready');
});
window.jjuuk.onSetSensitivity((t) => { threshold = t; });
window.jjuuk.onSetBaseline((b) => {
  // 저장된 baseline 복원 → 창을 띄우지 않고 백그라운드 감지 재개
  baseline = b;
});
window.jjuuk.onTheme((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});

init();

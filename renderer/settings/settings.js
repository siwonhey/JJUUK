const LEVELS = {
  1: {
    name: 'low',
    label: '여유롭게',
    desc: '자세가 크게 흐트러졌을 때만 알려드릴게요. 자유로운 작업에 좋아요.',
  },
  2: {
    name: 'normal',
    label: '보통',
    desc: '딱 알맞은 정도로 챙겨드려요. 잘 모르겠다면 이 설정을 추천해요.',
  },
  3: {
    name: 'high',
    label: '꼼꼼하게',
    desc: '작은 변화도 놓치지 않고 알려드릴게요. 자세에 신경 쓰고 싶을 때.',
  },
};

const NAME_TO_VALUE = { low: 1, normal: 2, high: 3 };
const VALID_DESIGNS = ['realistic', 'clay', 'cube', 'lowpoly', 'mommy'];
const VALID_SIZES = ['normal', 'small'];
const VALID_THEME_MODES = ['system', 'light', 'dark'];

// DOM
const slider = document.getElementById('slider');
const desc   = document.getElementById('desc');
const labels = document.querySelectorAll('.slider-labels span');
const openAtLoginToggle = document.getElementById('open-at-login');
const designSelect = document.getElementById('design-select');
const previewTurtle  = document.getElementById('preview-turtle');
const previewGiraffe = document.getElementById('preview-giraffe');
const notifSizeGroup = document.getElementById('notif-size');
const themeModeGroup = document.getElementById('theme-mode');

const staleBadge   = document.getElementById('stale-badge');
const baselineMeta = document.getElementById('baseline-meta');

// stats DOM
const statsEmpty   = document.getElementById('stats-empty');
const statsContent = document.getElementById('stats-content');
const goodHrEl     = document.getElementById('stats-good-hr');
const goodMinEl    = document.getElementById('stats-good-min');
const goodPctEl    = document.getElementById('stats-good-pct');
const barGood      = document.getElementById('stats-bar-good');
const barTurtle    = document.getElementById('stats-bar-turtle');
const barSlouch    = document.getElementById('stats-bar-slouch');
const valGood      = document.getElementById('stats-val-good');
const valTurtle    = document.getElementById('stats-val-turtle');
const valSlouch    = document.getElementById('stats-val-slouch');
const sevenDayPct  = document.getElementById('stats-7d-pct');

// ─── helpers ──────────────────────────────────────────────
function applyDesignPreview(design) {
  const safe = VALID_DESIGNS.includes(design) ? design : 'realistic';
  previewTurtle.src  = `../../assets/characters/${safe}/turtle.png`;
  previewGiraffe.src = `../../assets/characters/${safe}/giraffe.png`;
}

function positionArrow(value) {
  const labelEl = document.querySelector(`.slider-labels span[data-level="${value}"]`);
  if (!labelEl || !desc) return;
  const labelRect = labelEl.getBoundingClientRect();
  const descRect = desc.getBoundingClientRect();
  const arrowX = labelRect.left + labelRect.width / 2 - descRect.left;
  desc.style.setProperty('--arrow-x', `${arrowX}px`);
}

function renderSensitivity(value) {
  desc.textContent = LEVELS[value].desc;
  labels.forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.level) === Number(value));
  });
  positionArrow(value);
}

function setSegmentedActive(group, value) {
  for (const btn of group.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.value === value);
  }
}

function wireSegmented(group, validValues, onChange) {
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-value]');
    if (!btn || !group.contains(btn)) return;
    const value = btn.dataset.value;
    if (!validValues.includes(value)) return;
    setSegmentedActive(group, value);
    onChange(value);
  });
}

// ─── baseline meta ────────────────────────────────────────
function formatRelativeTime(ts) {
  if (!ts) return '아직 측정 기록이 없어요.';
  const diff = Date.now() - ts;
  const day = 86400 * 1000;
  if (diff < day) return '오늘 측정함';
  const days = Math.floor(diff / day);
  if (days < 7) return `${days}일 전에 측정함`;
  if (days < 30) return `${Math.floor(days / 7)}주 전에 측정함`;
  return `${Math.floor(days / 30)}개월 전에 측정함`;
}

function renderBaselineMeta(meta) {
  if (!meta || !meta.exists) {
    baselineMeta.textContent = '현재 자세를 새 기준으로 다시 기록해요.';
    staleBadge.hidden = true;
    return;
  }
  baselineMeta.textContent = formatRelativeTime(meta.createdAt) +
    (meta.stale ? ' — 한동안 안 바뀌었네요, 한 번 다시 잡아볼까요?' : '');
  staleBadge.hidden = !meta.stale;
}

// ─── stats ────────────────────────────────────────────────
function fmtMinutes(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}시간` : `${h}시간 ${rem}분`;
}

function pct(part, total) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

function renderStats(payload) {
  const days = payload.days || [];
  const today = days[days.length - 1] || { good: 0, turtleNeck: 0, slouch: 0, paused: 0 };

  const activeMs = today.good + today.turtleNeck + today.slouch;
  const hasData = activeMs > 0;
  statsEmpty.hidden = hasData;
  statsContent.hidden = !hasData;

  if (!hasData) return;

  const goodMin = Math.round(today.good / 60000);
  goodHrEl.textContent = Math.floor(goodMin / 60);
  goodMinEl.textContent = goodMin % 60;

  const goodPct = pct(today.good, activeMs);
  const turtlePct = pct(today.turtleNeck, activeMs);
  const slouchPct = pct(today.slouch, activeMs);
  // 100% 보정 (반올림 합 차이)
  const drift = 100 - (goodPct + turtlePct + slouchPct);
  const adjGoodPct = Math.max(0, goodPct + drift);

  goodPctEl.textContent = adjGoodPct + '%';
  barGood.style.width   = adjGoodPct + '%';
  barTurtle.style.width = turtlePct + '%';
  barSlouch.style.width = slouchPct + '%';

  valGood.textContent   = fmtMinutes(today.good);
  valTurtle.textContent = fmtMinutes(today.turtleNeck);
  valSlouch.textContent = fmtMinutes(today.slouch);

  // 7일 양호 비율
  let totalActive = 0;
  let totalGood = 0;
  for (const d of days) {
    totalActive += d.good + d.turtleNeck + d.slouch;
    totalGood += d.good;
  }
  sevenDayPct.textContent = pct(totalGood, totalActive) + '%';
}

async function refreshStats() {
  try {
    const payload = await window.jjuuk.getStats(7);
    renderStats(payload);
  } catch (e) {
    console.warn('[JJUUK] stats load failed', e);
  }
}

async function refreshBaselineMeta() {
  try {
    const meta = await window.jjuuk.getBaselineMeta();
    renderBaselineMeta(meta);
  } catch (e) {
    console.warn('[JJUUK] baseline meta load failed', e);
  }
}

// ─── init ─────────────────────────────────────────────────
(async function init() {
  const settings = await window.jjuuk.getSettings();

  const value = NAME_TO_VALUE[settings.sensitivity] || 2;
  slider.value = value;
  renderSensitivity(value);

  openAtLoginToggle.checked = !!settings.openAtLogin;

  const initialDesign = VALID_DESIGNS.includes(settings.characterDesign)
    ? settings.characterDesign
    : 'realistic';
  designSelect.value = initialDesign;
  applyDesignPreview(initialDesign);

  const initialSize = VALID_SIZES.includes(settings.notificationSize)
    ? settings.notificationSize
    : 'normal';
  setSegmentedActive(notifSizeGroup, initialSize);

  const initialThemeMode = VALID_THEME_MODES.includes(settings.themeMode)
    ? settings.themeMode
    : 'system';
  setSegmentedActive(themeModeGroup, initialThemeMode);
  // effectiveTheme 이 main 에서 계산돼 내려옴 — body 클래스도 즉시 반영
  document.body.classList.toggle('dark', settings.effectiveTheme === 'dark');

  renderBaselineMeta(settings.baseline);
  await refreshStats();
})();

slider.addEventListener('input', () => {
  const value = Number(slider.value);
  renderSensitivity(value);
  window.jjuuk.setSensitivity(LEVELS[value].name);
});

openAtLoginToggle.addEventListener('change', () => {
  window.jjuuk.setOpenAtLogin(openAtLoginToggle.checked);
});

document.getElementById('recalibrate-btn').addEventListener('click', () => {
  window.jjuuk.recalibrate();
  // 재측정 후 메타 갱신 — 측정창이 뜨고 잠시 후 finish 되면 main 이 baseline 저장
  setTimeout(refreshBaselineMeta, 6000);
});

designSelect.addEventListener('change', () => {
  const design = designSelect.value;
  applyDesignPreview(design);
  window.jjuuk.setCharacterDesign(design);
});

wireSegmented(notifSizeGroup, VALID_SIZES, (size) => {
  window.jjuuk.setNotificationSize(size);
});

wireSegmented(themeModeGroup, VALID_THEME_MODES, (mode) => {
  // light/dark 는 즉시 클라이언트에서 적용 — IPC 라운드트립 기다리면서 깜빡이지 않게.
  // system 은 OS 상태를 알아야 하니 IPC 응답(onTheme) 으로 반영.
  if (mode === 'light') document.body.classList.remove('dark');
  else if (mode === 'dark') document.body.classList.add('dark');
  window.jjuuk.setThemeMode(mode);
});

// 테마는 main 에서 effective 가 바뀌면 'theme:set' 으로 내려옴 — 동적으로 body 갱신
window.jjuuk.onTheme((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});

// Pretendard 가 늦게 로드되면 라벨 폭이 바뀌어 화살표가 어긋날 수 있음
window.addEventListener('load', () => positionArrow(Number(slider.value)));
if (document.fonts?.ready) {
  document.fonts.ready.then(() => positionArrow(Number(slider.value)));
}

// 설정 창이 열려 있는 동안 통계가 멈춰 보이지 않도록 주기 갱신
setInterval(refreshStats, 30 * 1000);

const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, nativeTheme,
  Notification, session, shell,
} = require('electron');
const path = require('path');
const Store = require('electron-store');
const { initAutoUpdater } = require('./updater');
const {
  SENSITIVITY_PRESETS,
  RECALIBRATION_RECOMMEND_DAYS,
  NOTIFICATION_SIZES,
  DEFAULT_NOTIFICATION_SIZE,
  THEME_MODES,
  DEFAULT_THEME_MODE,
  STATS_RETENTION_DAYS,
} = require('../shared/config');

const CHARACTER_DESIGNS = ['realistic', 'clay', 'cube', 'lowpoly', 'mommy'];
const DEFAULT_CHARACTER_DESIGN = 'realistic';

const store = new Store({
  defaults: {
    sensitivity: 'normal',
    active: true,
    openAtLogin: false,
    baseline: null,
    characterDesign: DEFAULT_CHARACTER_DESIGN,
    themeMode: DEFAULT_THEME_MODE,
    notificationSize: DEFAULT_NOTIFICATION_SIZE,
    stats: {},                 // { 'YYYY-MM-DD': { good, 'turtle-neck', slouch, paused } } — 단위 ms
    hasShownCloseNotice: false,
    hasShownPostCalibNotice: false,
    lastAlertedDeviceId: null, // 환경 변화 안내를 중복 발송하지 않기 위한 마지막 알린 카메라
  },
});

// 구버전(theme) → 신버전(themeMode) 마이그레이션
(function migrateLegacyTheme() {
  if (!store.has('themeMode') || store.get('themeMode') == null) {
    const legacy = store.get('theme');
    if (legacy === 'light' || legacy === 'dark') store.set('themeMode', legacy);
    else store.set('themeMode', DEFAULT_THEME_MODE);
  }
})();

// 구버전 baseline 은 createdAt 이 없음 → 업그레이드 시점을 기준일로 도장 찍음.
// 정확한 측정일은 모르지만 적어도 "신선도" 판단의 출발점이 생김.
(function migrateBaselineCreatedAt() {
  const b = store.get('baseline');
  if (b && !b.createdAt) {
    store.set('baseline', { ...b, createdAt: Date.now() });
  }
})();

// 단일 인스턴스 보장 — 두 번째 실행 시 즉시 종료해서 트레이 아이콘 중복 방지.
// (개발 중 npm start 를 여러 번 돌렸을 때 트레이가 N개 뜨던 문제 해결)
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => {
  // 사용자가 또 실행하면 — 새 트레이를 띄우는 대신 기존 detector 창을 보여줌
  if (detectorWin && !detectorWin.isDestroyed()) {
    if (detectorWin.isMinimized()) detectorWin.restore();
    detectorWin.show();
    detectorWin.focus();
  }
});

let tray = null;
let detectorWin = null;
const overlayWindows = new Map(); // displayId -> BrowserWindow
let settingsWin = null;
let trayPopupWin = null;
let popupLastHideAt = 0;
let isActive = store.get('active');
let isAppQuitting = false;
let isCalibrating = false;

// 마지막으로 알려진 자세 상태 — 통계 적립 + 다중 오버레이 동기화
let currentPostureState = 'good';

app.on('before-quit', () => {
  isAppQuitting = true;
  accrueStats(); // 종료 직전 누적
});

// 윈도우가 살아있는지(존재 + 미파괴) 한 번에 체크.
function alive(win) {
  return !!(win && !win.isDestroyed());
}

// ─── theme ─────────────────────────────────────────────────────
function effectiveTheme() {
  const mode = store.get('themeMode') || DEFAULT_THEME_MODE;
  if (mode === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return mode === 'dark' ? 'dark' : 'light';
}

function broadcastTheme() {
  const theme = effectiveTheme();
  for (const win of [settingsWin, trayPopupWin, detectorWin]) {
    if (alive(win)) win.webContents.send('theme:set', theme);
  }
  // 오버레이는 transparent 라 테마 영향 없음
}

nativeTheme.on('updated', () => {
  if (store.get('themeMode') === 'system') {
    broadcastTheme();
    // 다음에 띄울 윈도우의 첫 페인트 배경색도 업데이트되도록 별도 처리 없음 — 새 창은 effectiveTheme() 다시 읽음
  }
});

// ─── baseline freshness ───────────────────────────────────────
function isBaselineStale(baseline) {
  if (!baseline || !baseline.createdAt) return false;
  const ageMs = Date.now() - baseline.createdAt;
  return ageMs >= RECALIBRATION_RECOMMEND_DAYS * 86400 * 1000;
}

function baselineMeta() {
  const baseline = store.get('baseline');
  if (!baseline) return { exists: false, createdAt: null, stale: false };
  return {
    exists: true,
    createdAt: baseline.createdAt || null,
    stale: isBaselineStale(baseline),
  };
}

// ─── stats accumulator ────────────────────────────────────────
let statsTrackedState = isActive ? currentPostureState : 'paused';
let statsSince = Date.now();

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function accrueStats() {
  const now = Date.now();
  const elapsed = now - statsSince;
  statsSince = now;
  if (elapsed <= 0) return;
  const stats = store.get('stats') || {};
  const key = todayKey();
  if (!stats[key]) stats[key] = {};
  stats[key][statsTrackedState] = (stats[key][statsTrackedState] || 0) + elapsed;
  store.set('stats', stats);
}

function setTrackedState(next) {
  if (next === statsTrackedState) return;
  accrueStats();
  statsTrackedState = next;
  statsSince = Date.now();
}

function recomputeTrackedState() {
  setTrackedState(isActive ? currentPostureState : 'paused');
}

function pruneStats() {
  const stats = store.get('stats') || {};
  const cutoff = Date.now() - STATS_RETENTION_DAYS * 86400 * 1000;
  let changed = false;
  for (const key of Object.keys(stats)) {
    const t = Date.parse(key + 'T00:00:00');
    if (!isNaN(t) && t < cutoff) {
      delete stats[key];
      changed = true;
    }
  }
  if (changed) store.set('stats', stats);
}

function getStatsForDays(days) {
  const stats = store.get('stats') || {};
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const b = stats[key] || {};
    out.push({
      date: key,
      good: b.good || 0,
      turtleNeck: b['turtle-neck'] || 0,
      slouch: b.slouch || 0,
      paused: b.paused || 0,
    });
  }
  return out;
}

// 매분마다 강제 적립 — 앱이 한 상태로 오래 머물러도 누락 없이 store 반영
setInterval(() => accrueStats(), 60 * 1000);

// ─── notifications ────────────────────────────────────────────
function notify(title, body) {
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body, silent: true }).show();
  } catch (e) {
    console.warn('[JJUUK] notification failed', e);
  }
}

// ─── windows ──────────────────────────────────────────────────
function createDetectorWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const winW = Math.min(760, Math.floor(sw * 0.7));
  // hints/privacy-note 제거 후 컨텐츠 ~600px 정도. 하단 여백 줄여 답답하지 않게.
  const winH = Math.min(660, Math.max(600, sh - 80));
  detectorWin = new BrowserWindow({
    show: false,
    x: Math.floor((sw - winW) / 2),
    y: Math.floor((sh - winH) / 2),
    width: winW,
    height: winH,
    center: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'JJUUK',
    backgroundColor: effectiveTheme() === 'dark' ? '#1d1d1f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  detectorWin.setMenuBarVisibility(false);
  detectorWin.loadFile(path.join(__dirname, '..', 'renderer', 'detector', 'detector.html'));
  attachThemeDomReadyGuard(detectorWin);
  // X 로 닫으면 hide. 처음 한번은 트레이로 들어갔다는 사실을 사용자에게 알림.
  detectorWin.on('close', (e) => {
    if (isAppQuitting) return;
    e.preventDefault();
    detectorWin.hide();
    if (!store.get('hasShownCloseNotice')) {
      store.set('hasShownCloseNotice', true);
      notify('JJUUK 는 트레이에 머물고 있어요', '오른쪽 아래 트레이 아이콘을 누르면 다시 열 수 있어요.');
    }
  });
}

function createOverlayWindowForDisplay(display) {
  const { x, y, width, height } = display.workArea;
  const win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.send('character:set-design', store.get('characterDesign'));
    win.webContents.send('character:set-size', store.get('notificationSize'));
    // 새 디스플레이 연결 후 현재 자세 상태도 즉시 동기화
    win.webContents.send('posture:state', currentPostureState);
  });
  return win;
}

// 디스플레이 추가/제거/메트릭 변경 시 호출 — 차이만큼만 갱신
function syncOverlayWindows() {
  const displays = screen.getAllDisplays();
  const wantIds = new Set(displays.map((d) => d.id));

  // 사라진 디스플레이 윈도우 정리
  for (const [id, win] of overlayWindows.entries()) {
    if (!wantIds.has(id)) {
      if (alive(win)) win.destroy();
      overlayWindows.delete(id);
    }
  }
  // 새 디스플레이 윈도우 생성 + 기존은 작업영역 재맞춤
  for (const d of displays) {
    let win = overlayWindows.get(d.id);
    if (!win || !alive(win)) {
      win = createOverlayWindowForDisplay(d);
      overlayWindows.set(d.id, win);
    } else {
      const { x, y, width, height } = d.workArea;
      win.setBounds({ x, y, width, height });
    }
  }
}

function broadcastToOverlays(channel, payload) {
  for (const win of overlayWindows.values()) {
    if (alive(win)) win.webContents.send(channel, payload);
  }
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 460,
    height: 820,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'JJUUK 설정',
    icon: path.join(__dirname, '..', 'assets', 'app-icon.png'),
    backgroundColor: effectiveTheme() === 'dark' ? '#161616' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings', 'settings.html'));
  attachThemeDomReadyGuard(settingsWin);
  settingsWin.webContents.once('did-finish-load', () => {
    settingsWin.webContents.send('theme:set', effectiveTheme());
  });
}

function createTrayPopupWindow() {
  trayPopupWin = new BrowserWindow({
    width: 260,
    height: 156,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  trayPopupWin.setMenuBarVisibility(false);
  trayPopupWin.loadFile(path.join(__dirname, '..', 'renderer', 'tray-popup', 'popup.html'));
  attachThemeDomReadyGuard(trayPopupWin);
  trayPopupWin.webContents.once('did-finish-load', () => {
    trayPopupWin.webContents.send('theme:set', effectiveTheme());
  });
  trayPopupWin.on('blur', () => {
    if (trayPopupWin && !trayPopupWin.isDestroyed()) trayPopupWin.hide();
  });
  trayPopupWin.on('hide', () => {
    popupLastHideAt = Date.now();
  });
}

const POPUP_CARD_CONTENT_HEIGHT = 144; // 3 rows (켜기 / 다시 측정 / 설정) — 기존 2 rows 99 → 144
const POPUP_CARD_WIDTH = 260;
const SHADOW_PAD = 6;
const POPUP_BASE_HEIGHT = POPUP_CARD_CONTENT_HEIGHT + SHADOW_PAD * 2;

function showTrayPopup() {
  if (!trayPopupWin || trayPopupWin.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const trayBounds = tray.getBounds();
  const useTrayBounds = trayBounds.width > 0 && trayBounds.height > 0;
  const anchorX = useTrayBounds ? trayBounds.x + trayBounds.width / 2 : cursor.x;
  const anchorTop = useTrayBounds ? trayBounds.y : cursor.y - 16;
  const anchorBottom = useTrayBounds ? trayBounds.y + trayBounds.height : cursor.y + 16;

  const display = screen.getDisplayNearestPoint(cursor);
  const { x: dx, width: dw } = display.workArea;
  const screenTop = display.bounds.y;
  const screenBottom = display.bounds.y + display.bounds.height;
  const isMac = process.platform === 'darwin';

  const cardBottomInWindow = SHADOW_PAD + POPUP_CARD_CONTENT_HEIGHT;
  let winY;
  let winH;
  if (isMac) {
    winY = screenTop;
    winH = Math.max(POPUP_BASE_HEIGHT, (anchorBottom + POPUP_BASE_HEIGHT) - winY);
  } else {
    winY = anchorTop - cardBottomInWindow;
    winH = Math.max(POPUP_BASE_HEIGHT, screenBottom - winY);
  }

  let x = Math.round(anchorX - POPUP_CARD_WIDTH / 2);
  x = Math.max(dx + 4, Math.min(x, dx + dw - POPUP_CARD_WIDTH - 4));

  trayPopupWin.setSize(POPUP_CARD_WIDTH, winH);
  trayPopupWin.setPosition(Math.round(x), Math.round(winY));
  trayPopupWin.show();
  trayPopupWin.focus();
  try { trayPopupWin.webContents.send('popup:shown'); } catch { /* frame not ready yet */ }
}

function toggleTrayPopup() {
  if (Date.now() - popupLastHideAt < 250) return;
  if (trayPopupWin?.isVisible()) {
    trayPopupWin.hide();
  } else {
    showTrayPopup();
  }
}

function setActive(value) {
  isActive = !!value;
  store.set('active', isActive);
  if (alive(detectorWin)) detectorWin.webContents.send('posture:set-active', isActive);
  if (!isActive) {
    broadcastToOverlays('character:hide');
    currentPostureState = 'good';
  }
  recomputeTrackedState();
  updateTrayTooltip();
}

function triggerRecalibration() {
  if (!isActive) setActive(true);
  if (alive(detectorWin)) {
    isCalibrating = true;
    broadcastToOverlays('character:hide');
    detectorWin.show();
    detectorWin.webContents.send('posture:calibrate');
  }
}

function buildTrayContextMenu() {
  const meta = baselineMeta();
  const items = [
    {
      label: isActive ? 'JJUUK 일시정지' : 'JJUUK 감지 시작',
      click: () => setActive(!isActive),
    },
    {
      label: '자세 다시 측정' + (meta.stale ? ' (권장)' : ''),
      click: triggerRecalibration,
    },
    { type: 'separator' },
    { label: '설정 열기...', click: createSettingsWindow },
    { type: 'separator' },
    {
      label: 'JJUUK 종료',
      click: () => { isAppQuitting = true; app.quit(); },
    },
  ];
  return Menu.buildFromTemplate(items);
}

function updateTrayTooltip() {
  if (!tray) return;
  const status = isActive ? '자세 감지 중' : '일시정지됨';
  const warn = isBaselineStale(store.get('baseline')) ? ' · 재측정 권장' : '';
  tray.setToolTip(`JJUUK — ${status}${warn}`);
}

function setupTray() {
  const isMac = process.platform === 'darwin';
  const iconFile = isMac ? 'iconTemplate.png' : 'icon.ico';
  const iconPath = path.join(__dirname, '..', 'assets', 'tray', iconFile);
  const icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    console.error('[JJUUK] Tray icon failed to load from', iconPath);
  }
  if (isMac) icon.setTemplateImage(true);
  tray = new Tray(icon);
  updateTrayTooltip();
  // 좌클릭/더블클릭 → 팝업 토글 (기존 동작 유지)
  tray.on('click', toggleTrayPopup);
  tray.on('double-click', toggleTrayPopup);
  // 우클릭 → OS 네이티브 컨텍스트 메뉴 (Windows 컨벤션)
  tray.on('right-click', () => {
    tray.popUpContextMenu(buildTrayContextMenu());
  });
}

function applySensitivity(name) {
  store.set('sensitivity', name);
  const preset = SENSITIVITY_PRESETS[name] || SENSITIVITY_PRESETS.normal;
  if (alive(detectorWin)) detectorWin.webContents.send('posture:set-sensitivity', preset);
}

function applyCharacterDesign(name) {
  const design = CHARACTER_DESIGNS.includes(name) ? name : DEFAULT_CHARACTER_DESIGN;
  store.set('characterDesign', design);
  broadcastToOverlays('character:set-design', design);
}

function applyNotificationSize(name) {
  const size = NOTIFICATION_SIZES.includes(name) ? name : DEFAULT_NOTIFICATION_SIZE;
  store.set('notificationSize', size);
  broadcastToOverlays('character:set-size', size);
}

function applyThemeMode(mode) {
  const valid = THEME_MODES.includes(mode) ? mode : DEFAULT_THEME_MODE;
  store.set('themeMode', valid);
  broadcastTheme();
}

// DOM 이 막 만들어진 시점에 body 의 클래스를 직접 토글 → 첫 페인트부터 다크가 적용돼
// HTML 의 async init() 이 도착하기 전 light 깜빡임이 사라진다.
function attachThemeDomReadyGuard(win) {
  win.webContents.on('dom-ready', () => {
    const dark = effectiveTheme() === 'dark';
    win.webContents
      .executeJavaScript(
        `if (document.body) document.body.classList.toggle('dark', ${dark});`
      )
      .catch(() => {});
  });
}

function applyOpenAtLogin(value) {
  const enabled = !!value;
  store.set('openAtLogin', enabled);

  const settings = { openAtLogin: enabled };
  if (!app.isPackaged && process.platform === 'win32') {
    settings.path = process.execPath;
    settings.args = [path.resolve(__dirname, '..')];
  }
  app.setLoginItemSettings(settings);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });

  pruneStats();

  createDetectorWindow();
  syncOverlayWindows();           // 모든 디스플레이에 오버레이 생성
  createTrayPopupWindow();
  setupTray();

  applyOpenAtLogin(store.get('openAtLogin'));

  initAutoUpdater();              // GitHub Releases 자동 업데이트 확인

  // 디스플레이 핫플러그/해상도 변경 대응
  screen.on('display-added', syncOverlayWindows);
  screen.on('display-removed', syncOverlayWindows);
  screen.on('display-metrics-changed', syncOverlayWindows);

  detectorWin.webContents.once('did-finish-load', () => {
    applySensitivity(store.get('sensitivity'));
    detectorWin.webContents.send('posture:set-active', isActive);
    detectorWin.webContents.send('theme:set', effectiveTheme());
    const savedBaseline = store.get('baseline');
    if (savedBaseline) {
      detectorWin.webContents.send('posture:set-baseline', savedBaseline);
    } else {
      // 첫 부팅 — baseline 없음. 창 띄우고 측정 세션 시작 (intro → ready 흐름).
      detectorWin.show();
      detectorWin.webContents.send('posture:calibrate');
    }
  });

  // ── detector → main ───────────────────────────────────────
  ipcMain.on('posture:state', (_e, state) => {
    currentPostureState = state;
    if (!isCalibrating) broadcastToOverlays('posture:state', state);
    if (isActive) setTrackedState(state);
  });

  ipcMain.on('calibration:start', () => {
    detectorWin?.show();
    isCalibrating = true;
    broadcastToOverlays('character:hide');
  });
  ipcMain.on('calibration:done', () => {
    detectorWin?.hide();
    isCalibrating = false;
    broadcastToOverlays('posture:state', currentPostureState);
    if (!store.get('hasShownPostCalibNotice')) {
      store.set('hasShownPostCalibNotice', true);
      notify('JJUUK 가 트레이에서 자세를 봐 줄게요', '카메라가 백그라운드에서 동작합니다. 트레이 아이콘으로 언제든 일시정지하세요.');
    }
  });
  ipcMain.on('baseline:save', (_e, baseline) => {
    // 렌더러가 createdAt 을 같이 보내지만 신뢰성 위해 메인에서 한번 더 보장
    const stamped = { ...baseline, createdAt: baseline?.createdAt || Date.now() };
    store.set('baseline', stamped);
    updateTrayTooltip();
  });

  // ── settings ↔ main ──────────────────────────────────────
  ipcMain.handle('settings:get', () => ({
    sensitivity: store.get('sensitivity'),
    active: isActive,
    openAtLogin: store.get('openAtLogin'),
    characterDesign: store.get('characterDesign'),
    themeMode: store.get('themeMode'),
    effectiveTheme: effectiveTheme(),
    notificationSize: store.get('notificationSize'),
    baseline: baselineMeta(),
    platform: process.platform,
  }));
  ipcMain.on('settings:set-sensitivity', (_e, name) => applySensitivity(name));
  ipcMain.on('settings:set-open-at-login', (_e, value) => applyOpenAtLogin(value));
  ipcMain.on('settings:set-character-design', (_e, name) => applyCharacterDesign(name));
  ipcMain.on('settings:set-theme-mode', (_e, mode) => applyThemeMode(mode));
  ipcMain.on('settings:set-notification-size', (_e, size) => applyNotificationSize(size));

  // 구버전 호환 — 'settings:set-theme' (light/dark) 가 와도 themeMode 로 매핑
  ipcMain.on('settings:set-theme', (_e, name) => {
    applyThemeMode(name === 'dark' ? 'dark' : 'light');
  });

  // ── stats ↔ main ─────────────────────────────────────────
  ipcMain.handle('stats:get', (_e, days = 7) => {
    // 현재 진행 중인 segment 도 반영해야 "방금 전" 까지 포함된 수치가 보임
    accrueStats();
    return {
      days: getStatsForDays(Math.max(1, Math.min(30, days))),
      tracking: {
        state: statsTrackedState,
        sinceMs: Date.now() - statsSince,
      },
    };
  });

  // ── 팝업/설정 공용 액션 ───────────────────────────────────
  ipcMain.handle('app:get-active', () => isActive);
  ipcMain.handle('app:get-baseline-meta', () => baselineMeta());
  ipcMain.on('app:set-active', (_e, value) => setActive(value));
  ipcMain.on('app:recalibrate', triggerRecalibration);
  ipcMain.on('app:open-settings', () => {
    trayPopupWin?.hide();
    createSettingsWindow();
  });
  ipcMain.on('app:close-popup', () => trayPopupWin?.hide());

  // detector 가 활성 카메라 deviceId 를 알려줌 → baseline 측정 시점 카메라와 비교.
  // 다른 카메라면 환경 변화로 보고 사용자에게 재측정 권유 (같은 카메라엔 중복 안 알림).
  ipcMain.on('camera:device-id', (_e, deviceId) => {
    if (!deviceId) return;
    const baseline = store.get('baseline');
    if (!baseline?.deviceId) return;               // 비교 대상 없음 (구버전/첫 측정)
    if (baseline.deviceId === deviceId) return;    // 같은 카메라
    if (store.get('lastAlertedDeviceId') === deviceId) return;  // 이미 이 카메라로 알린 적 있음
    store.set('lastAlertedDeviceId', deviceId);
    notify(
      '카메라 환경이 바뀐 것 같아요',
      '평소와 다른 웹캠으로 측정되고 있어요. 자세 정확도를 위해 트레이에서 "자세 다시 측정" 을 권장해요.'
    );
  });

  // 카메라 권한 거부 시 OS 카메라 설정 페이지 열어주기
  ipcMain.on('app:open-camera-settings', () => {
    try {
      if (process.platform === 'darwin') {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera');
      } else if (process.platform === 'win32') {
        shell.openExternal('ms-settings:privacy-webcam');
      }
    } catch (e) {
      console.warn('[JJUUK] open camera settings failed', e);
    }
  });
});

app.on('window-all-closed', (e) => {
  e.preventDefault?.();
});

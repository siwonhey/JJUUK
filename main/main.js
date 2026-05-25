const { app, BrowserWindow, Tray, ipcMain, screen, nativeImage, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { SENSITIVITY_PRESETS } = require('../shared/config');

const CHARACTER_DESIGNS = ['realistic', 'clay', 'cube', 'lowpoly'];
const DEFAULT_CHARACTER_DESIGN = 'realistic';
const THEMES = ['light', 'dark'];
const DEFAULT_THEME = 'light';

const store = new Store({
  defaults: {
    sensitivity: 'normal',
    active: true,
    openAtLogin: false,
    baseline: null,
    characterDesign: DEFAULT_CHARACTER_DESIGN,
    theme: DEFAULT_THEME,
  },
});

let tray = null;
let detectorWin = null;
let overlayWin = null;
let settingsWin = null;
let trayPopupWin = null;
let popupLastHideAt = 0;
let isActive = store.get('active');
let isAppQuitting = false;

app.on('before-quit', () => { isAppQuitting = true; });

function createDetectorWindow() {
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;
  const winW = Math.min(760, Math.floor(sw * 0.7));
  // 상 40 + header(58) + 18(margin) + preview(360) + 6(margin) + messages(22) + 4(gap) + buttons(44) + 하 20 = 572
  // Windows 타이틀바 ~32 포함 → 약 604. 여유 두고 614.
  const winH = Math.min(614, Math.max(584, sh - 80));
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
    backgroundColor: store.get('theme') === 'dark' ? '#1d1d1f' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 창 hidden 상태에서도 rAF/감지 루프 유지
    },
  });
  detectorWin.setMenuBarVisibility(false);
  detectorWin.loadFile(path.join(__dirname, '..', 'renderer', 'detector', 'detector.html'));
  attachThemeDomReadyGuard(detectorWin);
  // 사용자가 X 로 닫아도 destroy 시키지 않음 — hide 만 시켜야 baseline 감지 루프가 살아있음.
  // app 종료 시(before-quit)만 진짜 close 통과.
  detectorWin.on('close', (e) => {
    if (isAppQuitting) return;
    e.preventDefault();
    detectorWin.hide();
  });
}

function createOverlayWindow() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;

  overlayWin = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
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
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  if (process.platform === 'darwin') {
    overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  overlayWin.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'overlay.html'));
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 440,
    height: 720,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'JJUUK 설정',
    icon: path.join(__dirname, '..', 'assets', 'characters', 'realistic', 'turtle.png'),
    // 첫 페인트가 흰색으로 깜빡이지 않도록 저장된 테마 기준으로 초기 배경 선택
    backgroundColor: store.get('theme') === 'dark' ? '#161616' : '#ffffff',
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
    settingsWin.webContents.send('theme:set', store.get('theme'));
  });
}

function createTrayPopupWindow() {
  trayPopupWin = new BrowserWindow({
    width: 260,
    height: 111,
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
    trayPopupWin.webContents.send('theme:set', store.get('theme'));
  });
  trayPopupWin.on('blur', () => {
    if (trayPopupWin && !trayPopupWin.isDestroyed()) trayPopupWin.hide();
  });
  trayPopupWin.on('hide', () => {
    popupLastHideAt = Date.now();
  });
}

// popup.html 카드의 실제 시각적 높이 (border 포함). 그림자 margin 은 별도.
const POPUP_CARD_CONTENT_HEIGHT = 99;
const POPUP_CARD_WIDTH = 260;
const SHADOW_PAD = 6;
const POPUP_BASE_HEIGHT = POPUP_CARD_CONTENT_HEIGHT + SHADOW_PAD * 2; // 111

function showTrayPopup() {
  if (!trayPopupWin || trayPopupWin.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const trayBounds = tray.getBounds();
  // Win11 등에서 가끔 0,0,0,0 으로 오는 경우 커서 좌표로 폴백
  const useTrayBounds = trayBounds.width > 0 && trayBounds.height > 0;
  const anchorX = useTrayBounds ? trayBounds.x + trayBounds.width / 2 : cursor.x;
  const anchorTop = useTrayBounds ? trayBounds.y : cursor.y - 16;
  const anchorBottom = useTrayBounds ? trayBounds.y + trayBounds.height : cursor.y + 16;

  const display = screen.getDisplayNearestPoint(cursor);
  const { x: dx, width: dw } = display.workArea;
  const screenTop = display.bounds.y;
  const screenBottom = display.bounds.y + display.bounds.height;
  const isMac = process.platform === 'darwin';

  // 카드의 시각적 하단(=윈도우 내부 좌표 SHADOW_PAD + CONTENT_HEIGHT)이 anchorTop 에
  // 정확히 닿도록 winY 를 계산. 윈도우 전체 높이가 아니라 카드 자체 높이로 계산해야
  // 시각적 갭이 없어진다.
  const cardBottomInWindow = SHADOW_PAD + POPUP_CARD_CONTENT_HEIGHT;
  let winY;
  let winH;
  if (isMac) {
    winY = screenTop;
    winH = Math.max(POPUP_BASE_HEIGHT, (anchorBottom + POPUP_BASE_HEIGHT) - winY);
  } else {
    winY = anchorTop - cardBottomInWindow;
    // 작업표시줄 트리거 영역까지 윈도우를 화면 하단까지 확장
    winH = Math.max(POPUP_BASE_HEIGHT, screenBottom - winY);
  }

  // 가로: 아이콘 가운데 정렬, 화면 안으로 clamp
  let x = Math.round(anchorX - POPUP_CARD_WIDTH / 2);
  x = Math.max(dx + 4, Math.min(x, dx + dw - POPUP_CARD_WIDTH - 4));

  trayPopupWin.setSize(POPUP_CARD_WIDTH, winH);
  trayPopupWin.setPosition(Math.round(x), Math.round(winY));
  trayPopupWin.show();
  trayPopupWin.focus();
  trayPopupWin.webContents.send('popup:shown');
}

function toggleTrayPopup() {
  // blur → hide 직후 click 이 도착해서 다시 show 되는 race 방지
  if (Date.now() - popupLastHideAt < 250) return;
  if (trayPopupWin?.isVisible()) {
    trayPopupWin.hide();
  } else {
    showTrayPopup();
  }
}

// 윈도우가 살아있는지(존재 + 미파괴) 한 번에 체크. destroyed 인데 ref 남아있는 케이스 방지.
function alive(win) {
  return !!(win && !win.isDestroyed());
}

function setActive(value) {
  isActive = !!value;
  store.set('active', isActive);
  if (alive(detectorWin)) detectorWin.webContents.send('posture:set-active', isActive);
  if (!isActive && alive(overlayWin)) overlayWin.webContents.send('character:hide');
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
  tray.setToolTip('JJUUK Buddy');
  // 좌클릭/우클릭/더블클릭 모두 토글 팝업. 설정 진입은 팝업 안의 "설정" 행으로.
  tray.on('click', toggleTrayPopup);
  tray.on('right-click', toggleTrayPopup);
  tray.on('double-click', toggleTrayPopup);
}

function applySensitivity(name) {
  store.set('sensitivity', name);
  const preset = SENSITIVITY_PRESETS[name] || SENSITIVITY_PRESETS.normal;
  if (alive(detectorWin)) detectorWin.webContents.send('posture:set-sensitivity', preset);
}

function applyCharacterDesign(name) {
  const design = CHARACTER_DESIGNS.includes(name) ? name : DEFAULT_CHARACTER_DESIGN;
  store.set('characterDesign', design);
  if (alive(overlayWin)) overlayWin.webContents.send('character:set-design', design);
}

function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : DEFAULT_THEME;
  store.set('theme', theme);
  // 오버레이는 transparent 라 별도 적용 필요 없음. 나머지 윈도우 전부에 브로드캐스트.
  for (const win of [settingsWin, trayPopupWin, detectorWin]) {
    if (win && !win.isDestroyed()) win.webContents.send('theme:set', theme);
  }
}

// DOM 이 막 만들어진 시점에 body 의 클래스를 직접 토글 → 첫 페인트부터 다크가 적용돼
// HTML 의 async init() 이 도착하기 전 light 깜빡임이 사라진다.
function attachThemeDomReadyGuard(win) {
  win.webContents.on('dom-ready', () => {
    const dark = store.get('theme') === 'dark';
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

  // 패키징된 앱(.exe / .app)은 process.execPath 가 곧 실행 파일이지만,
  // dev 환경(`electron .`)에서는 process.execPath 가 node_modules 안의
  // electron.exe 라서 인자(앱 경로)를 같이 넘겨주지 않으면 부팅 시
  // "To run a local app, execute …" 안내문만 떠 버린다.
  // path/args 는 Windows 에서만 의미가 있고 macOS 는 무시된다.
  const settings = { openAtLogin: enabled };
  if (!app.isPackaged && process.platform === 'win32') {
    settings.path = process.execPath;
    settings.args = [path.resolve(__dirname, '..')];
  }
  app.setLoginItemSettings(settings);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  // Electron 은 기본적으로 카메라 권한을 거부 — 명시적으로 허용
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media') return callback(true);
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media';
  });

  createDetectorWindow();
  createOverlayWindow();
  createTrayPopupWindow();
  setupTray();

  // 저장된 자동 실행 상태를 OS 시작프로그램과 동기화
  applyOpenAtLogin(store.get('openAtLogin'));

  detectorWin.webContents.once('did-finish-load', () => {
    applySensitivity(store.get('sensitivity'));
    detectorWin.webContents.send('posture:set-active', isActive);
    detectorWin.webContents.send('theme:set', store.get('theme'));
    const savedBaseline = store.get('baseline');
    if (savedBaseline) {
      // 이전 측정값 복원 → 트레이만 두고 백그라운드 감지
      detectorWin.webContents.send('posture:set-baseline', savedBaseline);
    } else {
      // 첫 실행: 캘리브레이션 위해 창 노출
      detectorWin.show();
    }
  });

  overlayWin.webContents.once('did-finish-load', () => {
    overlayWin.webContents.send('character:set-design', store.get('characterDesign'));
  });

  ipcMain.on('posture:state', (_e, state) => {
    if (alive(overlayWin)) overlayWin.webContents.send('posture:state', state);
  });

  ipcMain.on('calibration:start', () => detectorWin?.show());
  ipcMain.on('calibration:done', () => detectorWin?.hide());
  ipcMain.on('baseline:save', (_e, baseline) => {
    store.set('baseline', baseline);
  });

  ipcMain.handle('settings:get', () => ({
    sensitivity: store.get('sensitivity'),
    active: isActive,
    openAtLogin: store.get('openAtLogin'),
    characterDesign: store.get('characterDesign'),
    theme: store.get('theme'),
  }));
  ipcMain.on('settings:set-sensitivity', (_e, name) => {
    applySensitivity(name);
  });
  ipcMain.on('settings:set-open-at-login', (_e, value) => {
    applyOpenAtLogin(value);
  });
  ipcMain.on('settings:set-character-design', (_e, name) => {
    applyCharacterDesign(name);
  });
  ipcMain.on('settings:set-theme', (_e, name) => {
    applyTheme(name);
  });

  // 팝업/설정 공용 액션
  ipcMain.handle('app:get-active', () => isActive);
  ipcMain.on('app:set-active', (_e, value) => setActive(value));
  ipcMain.on('app:recalibrate', () => {
    // 일시정지 상태로 재측정하면 카메라가 꺼진 채라 동작 안 함 → 자동으로 ON
    if (!isActive) setActive(true);
    if (alive(detectorWin)) {
      detectorWin.show();
      detectorWin.webContents.send('posture:calibrate');
    }
  });
  ipcMain.on('app:open-settings', () => {
    trayPopupWin?.hide();
    createSettingsWindow();
  });
  ipcMain.on('app:close-popup', () => trayPopupWin?.hide());
});

app.on('window-all-closed', (e) => {
  e.preventDefault?.();
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jjuuk', {
  // detector → main
  sendPostureState: (state) => ipcRenderer.send('posture:state', state),
  notifyCalibStart: () => ipcRenderer.send('calibration:start'),
  notifyCalibDone: () => ipcRenderer.send('calibration:done'),
  saveBaseline: (b) => ipcRenderer.send('baseline:save', b),

  // main → detector listeners
  onSetActive: (cb) => ipcRenderer.on('posture:set-active', (_e, v) => cb(v)),
  onCalibrate: (cb) => ipcRenderer.on('posture:calibrate', cb),
  onSetSensitivity: (cb) => ipcRenderer.on('posture:set-sensitivity', (_e, v) => cb(v)),
  onSetBaseline: (cb) => ipcRenderer.on('posture:set-baseline', (_e, v) => cb(v)),

  // main → overlay listeners
  onPostureState: (cb) => ipcRenderer.on('posture:state', (_e, v) => cb(v)),
  onCharacterHide: (cb) => ipcRenderer.on('character:hide', cb),
  onCharacterDesign: (cb) => ipcRenderer.on('character:set-design', (_e, v) => cb(v)),

  // settings ↔ main
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSensitivity: (name) => ipcRenderer.send('settings:set-sensitivity', name),
  setOpenAtLogin: (value) => ipcRenderer.send('settings:set-open-at-login', value),
  setCharacterDesign: (name) => ipcRenderer.send('settings:set-character-design', name),
  setTheme: (name) => ipcRenderer.send('settings:set-theme', name),

  // 모든 윈도우 공통 — 테마 변경 broadcast 수신
  onTheme: (cb) => ipcRenderer.on('theme:set', (_e, v) => cb(v)),

  // 팝업/설정 공용 액션
  getActive: () => ipcRenderer.invoke('app:get-active'),
  setActive: (value) => ipcRenderer.send('app:set-active', value),
  recalibrate: () => ipcRenderer.send('app:recalibrate'),
  openSettings: () => ipcRenderer.send('app:open-settings'),
  closePopup: () => ipcRenderer.send('app:close-popup'),
  onPopupShown: (cb) => ipcRenderer.on('popup:shown', () => cb()),
});

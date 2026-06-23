const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');

// GitHub Releases 기반 자동 업데이트.
// - 패키징된 빌드에서만 동작 (개발 중 electron . 실행 시엔 건너뜀)
// - macOS는 Apple Developer ID 정식 서명이 있어야 실제 설치가 적용됨.
//   서명이 없으면 error 이벤트로 떨어지며, 여기서 잡아 앱이 죽지 않게만 처리한다.
function initAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err == null ? 'unknown error' : (err.stack || err).toString());
  });

  autoUpdater.on('update-downloaded', async (info) => {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      buttons: ['지금 재시작', '나중에'],
      defaultId: 0,
      cancelId: 1,
      title: '업데이트 준비 완료',
      message: `새 버전 ${info.version} 이(가) 다운로드되었습니다.`,
      detail: '지금 재시작하면 업데이트가 적용됩니다.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch((e) => {
    console.error('[autoUpdater] check failed', e);
  });
}

module.exports = { initAutoUpdater };

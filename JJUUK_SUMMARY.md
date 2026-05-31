# JJUUK — 자세 컴패니언

웹캠으로 자세를 실시간 감지해 거북목/굽은 등 자세가 되면 데스크탑 위에 캐릭터(거북이/기린)를 띄워서 슬쩍 알려주는 데스크탑 상주 앱.

---

## 1. 주요 기능

| 기능 | 동작 |
|---|---|
| **자세 캘리브레이션** | 첫 실행 시 3초간 정자세를 측정해 baseline 저장 |
| **실시간 자세 감지** | 카메라 영상에서 얼굴 위치/크기 변화를 baseline 과 비교 |
| **거북이 / 기린 오버레이** | 거북목 → 거북이, 굽은 등 → 기린 (투명 풀스크린 오버레이) |
| **트레이 토글** | 좌클릭 → gooey 토글 + 설정 진입. 우클릭 → 설정 창 (백업) |
| **카메라 진짜 OFF** | 토글 OFF 시 카메라 스트림 트랙 `.stop()` — LED 꺼짐 |
| **민감도 3단계** | 둔감 / 기본 / 민감 — `faceWidthRatio`, `faceYDelta` 임계치 변화 |
| **silent boot** | baseline 이 저장돼 있으면 캘리브레이션 창 안 띄우고 트레이만 상주 |
| **Windows 자동 실행** | 설정의 토글로 켜면 부팅 시 자동으로 트레이에 떠 있음 |
| **자세 재측정** | 설정에서 진입, 일시정지 상태였으면 자동으로 활성화 후 측정 |

---

## 2. 작동 방법

```
[웹캠]
   │ getUserMedia
   
   ▼
[MediaPipe FaceDetector (VIDEO 모드, GPU delegate)]
   │ detectForVideo(video, ts)
   ▼
[box → 정규화]
   faceWidth = box.width  / video.videoWidth
   faceY     = (box.originY + box.height/2) / video.videoHeight
   │
   ▼
[baseline 과 비교]
   widthRatio = faceWidth / baseline.faceWidth      → 1.15 이상이면 거북목
   yDelta     = faceY     - baseline.faceY          → 0.05 이상이면 굽은 등
   │
   ▼
[상태 머신 (히스테리시스 + 쿨다운)]
   │ posture:state IPC
   ▼
[오버레이 렌더러]   →  .visible 클래스 토글로 거북이/기린 등장
```

---

## 3. 기술 스택

| 영역 | 사용 기술 |
|---|---|
| 런타임 | Electron 33 (main + renderer + preload, contextIsolation) |
| 자세 감지 | `@mediapipe/tasks-vision` (FaceDetector, runningMode='VIDEO', GPU delegate) |
| 영구 저장 | `electron-store` (`sensitivity`, `active`, `openAtLogin`, `baseline`) |
| 자동 실행 | `app.setLoginItemSettings({ openAtLogin })` |
| UI | 순수 HTML/CSS/JS (프레임워크 없음), Pretendard 폰트 |
| 토글 애니메이션 | SVG `feGaussianBlur` + `feColorMatrix` 임계치 = **gooey 효과** |
| 패키징 | `electron-builder` (Windows: NSIS, macOS: dmg) |

---

## 4. 핵심 로직 디테일

### 4.1 자세 분류 우선순위

```js
if      (widthRatio >= threshold.faceWidthRatio) raw = 'turtle-neck';
else if (yDelta     >= threshold.faceYDelta)     raw = 'slouch';
else                                              raw = 'good';
```

거북이가 우선. 목+등 둘 다 굽어도 거북이가 이김 (UI 어수선 방지).

### 4.2 히스테리시스 + 쿨다운 + 직접 전환 차단

상태 머신을 4겹으로 안정화:

1. **Recovery ratio (0.9)** — bad → good 으로 가려면 임계치의 90% 이하로 떨어져야 함
2. **Bad → 다른 bad 직접 전환 차단** — 반드시 'good' 거쳐서 가야 함
3. **3초 쿨다운** — bad → good 직후 3초간은 어떤 bad 트리거도 무시
4. **700ms debounce** — 새 상태가 700ms 유지돼야 commit

→ "거북이가 사라지자마자 기린이 곧장 튀어나오는" 문제 해결

### 4.3 silent boot

baseline 은 in-memory 변수였는데 영구 저장으로 바꿈:

- `finishCalibration()` → `window.jjuuk.saveBaseline(b)` → `store.set('baseline', b)`
- 다음 실행 `did-finish-load` → store 에 baseline 있으면 `posture:set-baseline` 으로 복원, detector 창 안 띄움
- 없으면 첫 실행으로 간주하고 detector 창 띄워 캘리브레이션 유도

### 4.4 진짜 일시정지

`startCamera() / stopCamera()` 헬퍼:

```js
function stopCamera() {
  video.srcObject.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
}
```

토글 OFF → 카메라 LED 꺼짐. 토글 ON → `getUserMedia` 재호출, 저장된 baseline 으로 즉시 감지 재개. 일시정지 중 상태 머신이 stale 해질 수 있어 재개 시 `lastState/pendingState/cooldownUntil` 리셋.

### 4.5 트레이 팝업 위치 (Windows)

- `tray.getBounds()` 로 아이콘 좌표/크기 획득 (Win11 일부 0 반환 → 커서 좌표 폴백)
- 카드 그림자 margin(6px)만큼 보정해서 카드 바닥이 아이콘 상단에 딱 붙도록
- **윈도우 자체는 화면 하단까지 연장** → 자동숨김 작업표시줄이 메뉴 위에 커서 있는 동안 같이 안 내려가게

### 4.6 가이드 박스 vs baseline — "측정 기준은 본인 얼굴"

자주 헷갈리는 부분: **화면 중앙의 가이드 박스(`.face-guide`)는 baseline 이 아니다.** 가이드는 "이 영역에 앉아주세요" 라는 **권장 위치 표시**이자, 측정 중 표본을 받을지 말지 판단하는 **품질 필터**일 뿐. baseline 의 숫자 자체는 100% 본인 얼굴에서 나온다.

흐름을 코드로 보면:

```js
// loop() — 측정 중(calibInProgress)일 때
if (inGuide && result.detections.length > 0) {       // ← 가이드는 "샘플 채택할까?" 판단에만 사용
  const box = result.detections[0].boundingBox;       // ← MediaPipe 가 잡은 사용자의 실제 얼굴 박스
  calibBuffer.push({
    faceWidth: box.width / video.videoWidth,                     // 본인 얼굴 폭
    faceY:     (box.originY + box.height/2) / video.videoHeight, // 본인 얼굴 Y중심
  });
}

// finishCalibration() — 3초 종료 시점
baseline = {
  faceWidth: sum.faceWidth / calibBuffer.length,   // 본인 얼굴 폭의 평균
  faceY:     sum.faceY     / calibBuffer.length,   // 본인 얼굴 Y중심의 평균
};

// evaluate(m, ts) — 실시간 자세 판정
const widthRatio = m.faceWidth / baseline.faceWidth;   // 현재 얼굴 폭 / 내가 캡쳐한 폭
const yDelta     = m.faceY      - baseline.faceY;       // 현재 Y - 내가 캡쳐한 Y
```

세 단계 모두 비교 대상은 **`baseline.*` (내 얼굴의 캡쳐값)** 이고, 가이드 박스의 좌표/크기는 한 번도 비교식에 등장하지 않는다.

**왜 이렇게 설계됐나**: 사람마다 얼굴 크기·카메라 거리·앉은 자세가 다 다르다. 가이드 좌표를 baseline 으로 쓰면 "모두가 화면 정중앙에 같은 비율의 얼굴을 둔다" 는 비현실적 가정이 되어버린다. 본인 얼굴을 한 번 캡쳐해 두면, 사람마다의 정상 폭/높이가 자기 기준이 되어 거북목(폭이 커짐 = 카메라에 가까워짐) / 굽은 등(Y가 내려옴) 을 상대적으로 판단할 수 있다. 그래서 **촬영(3초) 의 의미는 "본인 정자세 baseline 수집"** 이다.

**가이드 박스의 진짜 역할**:
1. 사용자에게 "여기쯤 앉으세요" 시각 가이드
2. 측정 중 박스 안에 있을 때만 샘플 채택 → baseline 오염 방지
3. 측정 종료 시 in-guide 비율(`CALIB_VALID_RATIO = 0.7`)이 미달이거나 마지막 프레임이 박스 밖이면 `invalid` 처리해 baseline 저장 안 함 → 잘못된 기준값 방지

가이드 박스 크기/위치(28% width × 1:1, 중앙 정렬)와 `isInGuide()` 의 좌표 임계값은 시각/기능 동기화를 위해 항상 같이 조정한다. detector.html `.face-guide { width }` 와 detector.js `isInGuide()` 의 cx/cy/w 범위는 한 쌍이라는 점만 주의.

---

## 5. 시행착오 → 해결

### 5.1 부팅 후 트레이에 안 보임
- **원인**: 자동 실행 로직이 아예 없었음. 매번 수동으로 `npm start` 해야 됨.
- **해결**: `app.setLoginItemSettings({ openAtLogin: enabled })` + 설정 창에 토글 추가, `electron-store` 로 상태 영구화.

### 5.2 매번 캘리브레이션 창이 떠서 번거로움
- **원인**: baseline 이 in-memory 라 앱 재시작 시마다 다시 측정해야 했음.
- **해결**: baseline 을 `electron-store` 에 저장. 재시작 시 복원하고 detector 창은 띄우지 않음 (silent boot).

### 5.3 거북이가 들어가자마자 기린이 무조건 튀어나옴
- **원인**: 복구 히스테리시스가 거북이 → good 전환에만 적용되고 거북이 → 기린 직접 전환을 안 막았음. 사용자가 뒤로 물러나며 모니터 쪽으로 고개를 살짝 숙이는 자연스러운 동작이 `yDelta` 임계치를 넘어 곧장 slouch 로 점프.
- **해결**: ① bad → 다른 bad 직접 전환 차단 (`raw = lastState`) ② good 복귀 후 3초 쿨다운 추가.

### 5.4 트레이 메뉴 UX
- **원인**: 기본 Electron `Menu.buildFromTemplate` 은 OS 가 그려서 커스텀 UI/애니메이션 불가.
- **해결**: 트레이 좌클릭 시 별도 frameless transparent BrowserWindow 를 트레이 아이콘 위에 띄우는 방식으로 변경. 카드 안에 React 코드(다른 프로젝트 사용)를 순수 HTML/CSS 로 포팅한 **gooey 토글** + 설정 진입 메뉴 행.

### 5.5 일시정지인데 카메라 LED 가 계속 켜져 있음
- **원인**: `isActive=false` 플래그만 내리고 detectForVideo 호출만 스킵 → 카메라 스트림은 그대로 점유.
- **해결**: 토글 OFF 시 `video.srcObject.getTracks().forEach(t => t.stop())` 으로 트랙 해제, 토글 ON 시 `getUserMedia` 재호출. "JJUUK 종료" 버튼은 사용 빈도가 너무 낮아 제거하고, "일시정지 = 진짜 OFF" 로 일원화.

### 5.6 일시정지 후 재개 시 캐릭터가 안 뜸
- **원인 1**: 일시정지 직전 `lastState='turtle-neck'` 이 그대로 남아있었는데, 오버레이는 `character:hide` IPC 로 'good' 으로 초기화돼서 양쪽 상태가 어긋남. detector 가 보낸 state 가 무시됨 (pendingState === lastState 라 IPC 안 보냄).
- **원인 2**: `video.onloadedmetadata = r` 로 리스너 등록했는데, srcObject 재할당 시 이벤트가 이미 발생한 뒤라 await 가 영원히 풀리지 않을 수 있음.
- **해결**: ① 재개 시 `lastState/pendingState/cooldownUntil` 리셋 ② `addEventListener('loadedmetadata', ..., { once: true })` + `readyState` 체크로 시점 안전화.

### 5.7 팝업 위치 (자동숨김 작업표시줄 + 아이콘과의 간격)
- **시도 1 (부유)**: 작업영역 하단 고정 → 자동숨김 시 작업표시줄이 사라지면 팝업이 공중에 떠 있음.
- **시도 2 (아이콘 위)**: `cursor.y - winH - 8px` → 커서가 아이콘 중앙 좌표라서 항상 ~15px 떠 있음.
- **시도 3 (`tray.getBounds()`)**: 아이콘 실제 위치 사용 → 윈도우는 붙음. 그런데 카드 자체는 그림자 margin(6px)만큼 여전히 떠 보임.
- **해결**: 윈도우 Y 를 SHADOW_PAD(6) 만큼 더 내려서 카드 바닥이 아이콘 상단 좌표와 정확히 일치하게.

### 5.8 메뉴가 떠 있는데 작업표시줄이 자동 숨김됨
- **원인**: 자동숨김 작업표시줄은 cursor/window 가 트리거 영역과 안 겹치면 다시 숨음. 우리 팝업은 작업표시줄 위에 떠 있어서 트리거 영역과 분리됨.
- **해결**: 팝업 윈도우 세로 길이를 카드 위치부터 **화면 하단까지** 늘려서 작업표시줄 영역과 항상 겹치게. 카드는 윈도우 상단에 그대로 두고 아래쪽은 투명. 시스템이 팝업 윈도우가 트리거 영역을 차지한 걸로 인식해 작업표시줄이 안 내려감.
- **부작용**: 커서가 트레이 아이콘 위에 가도 클릭이 팝업으로 가서 직접 트레이 클릭으로 팝업 토글이 안 됨. → 대신 mouseleave 250ms grace 후 자동 닫힘으로 보완.

---

## 6. 파일 구성

```
.
├── main/
│   ├── main.js          # 트레이, 윈도우 4종 생성, IPC, electron-store
│   └── preload.js       # 렌더러에 노출할 API (contextBridge)
├── renderer/
│   ├── detector/        # 카메라 + MediaPipe + 캘리브레이션 UI
│   ├── overlay/         # 거북이/기린 풀스크린 투명 오버레이
│   ├── settings/        # 민감도 슬라이더, 자동실행 토글, 자세 재측정 버튼
│   └── tray-popup/      # gooey 토글 + 설정 진입 (트레이 좌클릭 시 표시)
├── shared/
│   └── config.js        # SENSITIVITY_PRESETS, DEBOUNCE_MS, RECOVERY_RATIO
└── assets/
    ├── tray/            # 트레이 아이콘 (icon.ico, iconTemplate.png)
    └── mediapipe/       # face_detector.tflite 모델
```

각 BrowserWindow 는 같은 `preload.js` 를 공유해서 동일한 `window.jjuuk.*` API 사용.

---

## 7. 배포 계획

### 7.1 dev 환경의 자동 실행 함정

- `app.setLoginItemSettings({ openAtLogin: true })` 만 호출하면 Windows 시작 프로그램에는 `process.execPath` (= `node_modules\electron\dist\electron.exe`) 만 등록됨.
- electron.exe 는 인자 없이 실행되면 "To run a local app, execute the following…" 도움말만 띄움 → 트레이 아이콘 안 뜸.
- **해결**: `app.isPackaged === false` 일 때만 `path` + `args` (앱 폴더) 같이 넘김. 패키징 후에는 `.exe` 자체가 실행 파일이라 분기 필요 없음.

```js
const settings = { openAtLogin: enabled };
if (!app.isPackaged && process.platform === 'win32') {
  settings.path = process.execPath;
  settings.args = [path.resolve(__dirname, '..')];
}
app.setLoginItemSettings(settings);
```

### 7.2 Windows 정식 배포 (NSIS)

| 단계 | 명령/작업 | 산출물 |
|---|---|---|
| 1 | `npm run build:win` | `dist/JJUUK Setup 0.1.0.exe` (NSIS 인스톨러) |
| 2 | 사용자가 인스톨러 실행 | `%LOCALAPPDATA%\Programs\JJUUK\JJUUK.exe` |
| 3 | 앱 안 "자동 실행" 토글 | `JJUUK.exe` 가 직접 등록되므로 안내문 없이 부팅 시 트레이 직행 |

**아이콘**: 현재 `assets/tray/icon@2x.png` 를 윈도우 빌드 아이콘으로 쓰지만, NSIS 는 multi-resolution `.ico` (16/32/48/64/128/256) 가 안정적. 추후 `assets/tray/icon.ico` 만들어서 `build.win.icon` 교체 추천.

**SmartScreen**: 코드 서명 없는 .exe 는 첫 실행 시 "Windows 가 PC 를 보호했습니다" 경고가 뜸. 사용자가 "추가 정보 → 실행" 으로 우회 가능. 정식 배포는 EV Code Signing Certificate(연 $300+) 가 깔끔하지만 사내 사용 단계에서는 과함.

### 7.3 macOS 정식 배포 (dmg)

| 단계 | 명령/작업 | 산출물 |
|---|---|---|
| 1 | `npm run build:mac` | `dist/JJUUK-0.1.0.dmg`, `JJUUK-0.1.0-mac.zip` |
| 2 | dmg → `Applications` 드래그 | `/Applications/JJUUK.app` |
| 3 | 첫 실행 시 카메라 권한 허용 (`NSCameraUsageDescription` 이미 설정됨) | — |
| 4 | "자동 실행" 토글 | 로그인 항목 등록, 메뉴바에 자동 등장 |

**Dock 에 잠깐도 안 띄우기**: `dock.hide()` 만으로는 부족할 수 있어 `extendInfo` 에 `LSUIElement: true` 추가 권장.

```json
"extendInfo": {
  "NSCameraUsageDescription": "JJUUK 은 …",
  "LSUIElement": true
}
```

**Gatekeeper**: 코드 사인/공증 안 하면 첫 실행 시 "확인되지 않은 개발자" 경고 → 우클릭 > 열기로 우회. 정식은 Apple Developer Program(연 $99) + `mac.identity` 설정 + notarization 필요.

### 7.4 인앱 자동 업데이트 — 지금 가능? (결론: 가능. 함정 있음)

`electron-updater` 로 GitHub Releases 또는 자체 서버에서 새 빌드를 가져와 자동 설치 가능. 팀원이 처음 한 번만 설치하면 그 다음부터 다이얼로그 한 번 클릭으로 업데이트 됨.

**기본 셋업 (GitHub Releases 기준)**:

```bash
npm i electron-updater
```

```jsonc
// package.json
"build": {
  "publish": [{
    "provider": "github",
    "owner": "<github-username>",
    "repo": "<repo-name>"
  }],
  ...
}
```

```js
// main/main.js
const { autoUpdater } = require('electron-updater');
app.whenReady().then(() => {
  // ... 기존 코드 ...
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify();
});
```

빌드 + 업로드 한 번에:
```bash
# GH_TOKEN = "repo" 권한 personal access token
set GH_TOKEN=ghp_xxx && npm run build:win -- --publish=always
```

`latest.yml` + `JJUUK Setup 0.1.0.exe` + blockmap 이 GitHub Release 에 자동 첨부됨. 다음 버전 올리면 기존 사용자들이 자동으로 받아감.

**팀 사용 시나리오별 선택지**:

| 시나리오 | 추천 방식 | 장점 | 함정 |
|---|---|---|---|
| 코드 공개 OK | **public repo + GitHub Releases** | 셋업 가장 간단, 토큰 불필요 | 소스코드 노출 |
| 사내 비공개 | **private repo + GH_TOKEN 분배** | 코드 비공개 유지 | 팀원 모두 PAT 필요, 만료 관리 귀찮음 |
| 인프라 통제 원함 | **자체 S3/Nginx + provider: 'generic'** | URL 패턴 자유, 사내 SSO 연동 가능 | 호스팅 비용/관리, blockmap 직접 업로드 |
| 그냥 한 번에 끝 | **dmg/exe 슬랙 공유** | 셋업 0분 | 매번 수동 재설치 |

**Windows 함정**:
- 코드 서명 없으면 자동 업데이트는 동작하지만 **SmartScreen 경고가 매 메이저 버전마다 다시 뜸** (서명 reputation 미축적). 사내 팀은 한 번 안내하면 OK.
- NSIS auto-updater 는 백그라운드로 다운로드 → 다음 실행 때 적용.

**macOS 함정** (가장 큰 장벽):
- **코드 사인 + 공증 안 한 앱은 electron-updater 자동 설치가 차단됨**. Gatekeeper 가 unsigned 업데이트 거부.
- 우회: 처음에만 dmg 수동 설치, 이후도 메이저 업데이트는 수동. 또는 Mac 만 별도 채널(슬랙 공유) 운영.
- 진짜 자동 업데이트하려면 Apple Developer Program($99/yr) + `mac.identity` + notarization. 우리 팀 Mac 비중 보고 결정.

**권장 (지금 단계)**:
1. **private GitHub repo + Releases + electron-updater (Windows 만 자동 업데이트)**
2. Mac 은 첫 한두 명만 있으니 dmg 직접 공유, 나중에 도입 결정
3. CI(.github/workflows/build.yml) 없이 빌드 담당자가 로컬에서 `--publish=always` 로 올리는 방식 → 셋업 1시간, 추가 비용 0
4. 사용자가 2~3명 늘면 GitHub Actions 로 태그 푸시 → 자동 빌드/배포 자동화

### 7.5 향후 점진적 확장

- v0.2: `electron-updater` 도입 (Windows 자동 업데이트)
- v0.3: `.github/workflows` 로 빌드 자동화 (tag push → release)
- v0.4: Mac 코드 사인/공증 도입 시점 — 사용자 5명+ 가 기준
- v1.0: EV Code Signing(Win) — SmartScreen 완전 제거가 필요할 때

---

## 8. 서비스 소개 (발표용)

JJUUK(쭉) 은 웹캠으로 사용자의 자세를 실시간 감지해 거북목이나 굽은 등 자세가 나타나면 데스크탑 화면에 거북이·기린 캐릭터를 슬쩍 띄워 부드럽게 알려주는 자세 케어 서비스다. 사용자는 트레이에 상주하는 앱을 통해 백그라운드에서 자세를 관리하고, 자신의 자세 이력을 일별 리포트로 확인할 수 있다. 첫 실행 시 3초간 정자세를 측정해 baseline(얼굴 박스의 폭과 중심 Y좌표 평균) 을 저장한 뒤, 이후 매 프레임마다 baseline 대비 변화량으로 자세를 판정한다. 얼굴 폭만 늘어나고 Y좌표는 안정적이면 거북목, Y좌표가 임계치 이상 내려가면 굽은 등으로 분류하며, 700ms 디바운스와 3초 쿨다운, 양방향 히스테리시스로 알림이 짧은 자세 흔들림에 깜빡이지 않도록 안정화했다. 자세 상태가 바뀌면 메인 프로세스가 IPC 로 모든 연결된 디스플레이의 풀스크린 투명 오버레이에 동시 전파해 어느 모니터를 보고 있어도 알림이 보이게 된다.

기술 스택은 런타임으로 Electron 33(메인·렌더러·preload 분리, contextIsolation 적용), 자세 감지에 Google MediaPipe Tasks Vision 의 FaceDetector(WASM 기반, GPU delegate + CPU 폴백) 를 사용한다. 영속화는 별도 DB 없이 electron-store 가 관리하는 단일 JSON 파일에 사용자 설정과 일별 자세 통계까지 함께 저장하며, UI 는 별도 프레임워크 없이 순수 HTML/CSS/JS 와 Pretendard 폰트로 구성했다. 패키징은 electron-builder 로 Windows(NSIS)·macOS(dmg) 빌드를 지원한다.

주요 기능으로는 3초 캘리브레이션, 실시간 자세 감지와 캐릭터 오버레이, 트레이 좌클릭의 gooey 토글 팝업과 우클릭의 네이티브 컨텍스트 메뉴, 멀티 모니터 자동 대응(디스플레이 핫플러그 포함), 일별 자세 통계 리포트(로컬 자정 기준 버킷, 30일 보관), 14일 경과 시 재측정 권장 배지, 카메라 디바이스 변경 자동 감지와 안내, 시스템 다크모드 자동 추종, 알림 크기 옵션(보통·작게), 부팅 시 자동 실행, 단일 인스턴스 보장이 있다. 카메라 권한 거부 등 오류 상황에 OS별 카메라 설정 페이지로 바로 이동시켜 사용자가 막다른 길에 갇히지 않도록 했다.

배포는 아직 실제 출시 전 준비 단계로, `electron-builder` 설정과 빌드 스크립트(`npm run build:win` / `build:mac`)는 갖춰져 있지만 인스톨러 산출물을 실제로 만들어 배포한 적은 없는 상태다. 단계적 출시 계획은 다음과 같다. 1단계는 빌드 담당자가 로컬에서 만든 Windows NSIS 인스톨러(.exe)와 macOS dmg 를 사내 사용자에게 슬랙으로 직접 공유하는 가장 가벼운 방식으로 시작한다. 2단계로 `electron-updater` + private GitHub Releases 를 연동해 Windows 사용자는 다이얼로그 한 번 클릭으로 자동 업데이트되도록 만들고, 사용자 수가 늘어나면 3단계에서 GitHub Actions 워크플로로 태그 푸시 기반 빌드·배포까지 자동화한다. macOS 자동 업데이트는 Apple Developer Program(연 $99) 가입과 코드 사인·공증이 필요하기 때문에 초기에는 수동 dmg 공유로 운영하고 사용자 비중이 일정 규모를 넘긴 시점에 도입 여부를 결정한다. 코드 서명 없는 동안 Windows SmartScreen·macOS Gatekeeper 경고가 첫 실행 시 뜨지만 사용자 안내로 우회 가능하며, EV Code Signing Certificate(연 $300+) 같은 비용 항목은 사내 단계에서는 보류하고 정식 공개 배포 시점에 다시 검토한다.

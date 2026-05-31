# JJUUK — v0.2 보완 작업 요약

피드백으로 짚인 기능/디자인 이슈를 한 번에 처리한 작업 기록.
(제외 항목: ⑨ 알림 빈도 조절, ⑩ 다국어 지원)

---

## 1. 한눈에 보기

| 영역 | 핵심 변경 |
|---|---|
| 멀티 모니터 | overlay 싱글톤 → 디스플레이별 윈도우 Map. 핫플러그/해상도 변경 자동 반영 |
| 거북목 정확도 | "폭만 늘고 Y는 안정" 일 때만 거북목. 둘 다 늘면 굽은등에 양보 |
| baseline 신선도 | createdAt 저장, 14일 초과 시 "재측정 권장" 배지/툴팁 |
| 여러 얼굴 처리 | 가이드 안 얼굴 우선 / 평가 시 가장 큰 얼굴 우선 |
| 통계/리포트 | 일별 상태 시간 누적, 설정창 "오늘의 자세 리포트" 카드 |
| 카메라 권한 복구 | 에러별 친절 안내 + "OS 카메라 설정 열기" 버튼 |
| detector 창 X | 첫 닫기 시 "트레이에 있어요" 시스템 알림 |
| 트레이 우클릭 | 네이티브 컨텍스트 메뉴 (일시정지/재측정/설정/종료) |
| 트레이 툴팁 | "JJUUK — 자세 감지 중 · 재측정 권장" 식 동적 갱신 |
| 시스템 다크모드 | themeMode: system/light/dark, 자동이 기본값 |
| 알림 크기 | 보통(풀스크린) / 작게(우하단 코너) 선택 |
| 캘리브레이션 안내 | 사전 hint chip 3개, 사후 시스템 알림, 개인정보 푸터 |
| 캐릭터 이름 | "Mommy" → "엄마 거북이 · 기린" |
| 트레이 팝업 | 2행 → 3행 (켜기 / 다시 측정 + 권장 배지 / 설정) |

---

## 2. electron-store 스키마 변화

```diff
{
  sensitivity: 'normal',
  active: true,
  openAtLogin: false,
  baseline: null,
  characterDesign: 'realistic',
- theme: 'light',
+ themeMode: 'system',                // 'system' | 'light' | 'dark'
+ notificationSize: 'normal',         // 'normal' | 'small'
+ stats: {},                          // { 'YYYY-MM-DD': { good, 'turtle-neck', slouch, paused } } — ms
+ hasShownCloseNotice: false,
+ hasShownPostCalibNotice: false,
}
```

baseline 도 `createdAt: number` 필드 추가.

**자동 마이그레이션** (main.js 모듈 로드 시 1회):
- 구 `theme` 값 → `themeMode` 로 매핑
- 구 baseline 에 `createdAt` 없으면 `Date.now()` 도장 (정확한 측정일은 모르지만 신선도 판단의 출발점)

---

## 3. shared/config.js 신규 상수

```js
TURTLE_NECK_Y_TOLERANCE_FACTOR = 0.6;     // 거북목 인정용 Y 안정 조건 (threshold의 60% 미만)
RECALIBRATION_RECOMMEND_DAYS   = 14;      // 이 이상 지나면 재측정 권장
NOTIFICATION_SIZES             = ['normal', 'small'];
DEFAULT_NOTIFICATION_SIZE      = 'normal';
THEME_MODES                    = ['light', 'dark', 'system'];
DEFAULT_THEME_MODE             = 'system';
STATS_RETENTION_DAYS           = 30;      // 일별 버킷 보관 기간
```

---

## 4. 핵심 로직 변화

### 4.1 자세 분류 우선순위 뒤집기 (#2, #9 기능)

```js
// 이전 — 거북목 우선. 두 신호가 다 켜져도 거북이가 영원 우세 → 기린 안 보임.
if      (widthRatio >= W) raw = 'turtle-neck';
else if (yDelta     >= Y) raw = 'slouch';

// 이후 — y가 흐트러지면 굽은등 우선. 거북목은 "폭만 늘고 Y는 안정"일 때만.
if (yDelta >= Y)                              raw = 'slouch';
else if (widthRatio >= W && yDelta < Y * 0.6) raw = 'turtle-neck';
```

| 신호 조합 | 이전 | 이후 |
|---|---|---|
| w↑ only | 거북목 | 거북목 |
| y↑ only | 굽은등 | 굽은등 |
| w↑ + y↑ | 거북목 | **굽은등** ← 기린 살아남 |
| w 살짝↑, y borderline | 거북목 | **good** (모호 영역은 알림 안 함) |

### 4.2 다중 얼굴 선택 (#4 기능)

```js
function selectBestDetection(detections, prefer) {
  if (prefer === 'in-guide') {
    const inGuide = detections.filter(...);
    if (inGuide.length) return inGuide.reduce(largestArea);
  }
  return detections.reduce(largestArea);
}
```

- 캘리브레이션 중: `'in-guide'` → 옆사람이 baseline 오염시키지 못함
- 평가 중: `'any'` → 가장 큰 얼굴 = 카메라에 가장 가까운 본인

### 4.3 baseline 분산 체크 (#3 기능 보조)

`finishCalibration()` 에서 `faceWidth` 표준편차 계산.
`stddev > 0.025` 면 측정 중 거리가 흔들렸다는 신호 → `'invalid'` 처리 + "자세가 흔들렸어요" 안내.

### 4.4 멀티 모니터 (#1 기능)

```js
const overlayWindows = new Map(); // displayId -> BrowserWindow

function syncOverlayWindows() {
  // diff: 사라진 디스플레이 → destroy, 새 디스플레이 → create, 기존 → bounds 재맞춤
}

screen.on('display-added',           syncOverlayWindows);
screen.on('display-removed',         syncOverlayWindows);
screen.on('display-metrics-changed', syncOverlayWindows);

function broadcastToOverlays(channel, payload) {
  for (const win of overlayWindows.values()) {
    if (alive(win)) win.webContents.send(channel, payload);
  }
}
```

- 디스플레이 단위 `display.workArea` 로 bound 설정 → dock/taskbar 침범 X
- posture state / character design / size 변경은 전부 broadcastToOverlays 로 전파
- 새 디스플레이 add 직후엔 현재 자세 상태도 즉시 동기화

### 4.5 통계 누적기 (#6 기능)

```js
let statsTrackedState = isActive ? 'good' : 'paused';
let statsSince = Date.now();

function accrueStats() {
  // 현재 segment 의 elapsed 를 오늘 버킷의 statsTrackedState 슬롯에 가산
}
function setTrackedState(next) {
  if (next === statsTrackedState) return;
  accrueStats();
  statsTrackedState = next;
  statsSince = Date.now();
}
```

트리거:
- `posture:state` 수신 (isActive 한정)
- `setActive(false/true)` → 'paused' 로/에서 전환
- `setInterval(60_000)` 강제 적립 (한 상태로 오래 머물러도 store 가 정체되지 않음)
- `before-quit` 종료 직전 적립
- `stats:get` IPC 응답 직전에도 accrue → "지금 이 순간"까지 반영

보관 정책: 30일 초과 버킷은 부팅 시 `pruneStats()` 가 정리.

### 4.6 카메라 에러 패널 (#7 기능)

```js
function describeCameraError(e) {
  switch (e?.name) {
    case 'NotAllowedError':  return { title: '카메라 권한이 거부됨', body: 'OS별 안내…' };
    case 'NotFoundError':    return { title: '카메라 없음',         body: '…' };
    case 'NotReadableError': return { title: '다른 앱이 사용 중',    body: '…' };
    default:                 return { title: '카메라를 켤 수 없어요', body: e.message };
  }
}
```

detector 의 preview 위에 절대 위치 검은 패널 + 다시 시도 + OS 카메라 설정 열기 (`ms-settings:privacy-webcam` / `x-apple.systempreferences:com.apple.preference.security?Privacy_Camera`).

### 4.7 트레이 우클릭 메뉴 (#13 디자인)

```js
tray.on('click',        toggleTrayPopup);   // 좌클릭 — 기존 gooey 팝업
tray.on('double-click', toggleTrayPopup);
tray.on('right-click', () => tray.popUpContextMenu(buildTrayContextMenu()));
```

컨텍스트 메뉴: `[일시정지/감지 시작] [자세 다시 측정(권장)] --- [설정 열기...] --- [JJUUK 종료]`. baseline stale 시 "재측정" 항목에 "(권장)" 라벨 자동 부착.

### 4.8 동적 트레이 툴팁 (#7 디자인)

`updateTrayTooltip()` 가 `isActive` + baseline stale 여부 조합으로 갱신:
- `JJUUK — 자세 감지 중`
- `JJUUK — 자세 감지 중 · 재측정 권장`
- `JJUUK — 일시정지됨`
- `JJUUK — 일시정지됨 · 재측정 권장`

호출 지점: `setActive()`, `baseline:save`, `setupTray()` 직후.

### 4.9 시스템 다크모드 (#5 디자인)

```js
function effectiveTheme() {
  const mode = store.get('themeMode');
  if (mode === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return mode === 'dark' ? 'dark' : 'light';
}

nativeTheme.on('updated', () => {
  if (store.get('themeMode') === 'system') broadcastTheme();
});
```

설정창은 라디오 대신 Apple segmented control(자동/라이트/다크). 첫 페인트 깜빡임 방지 위해 윈도우의 `backgroundColor` 도 `effectiveTheme()` 기준으로 동적 결정.

### 4.10 알림 크기 (#11 디자인)

CSS `body.size-small` 분기:

```css
body.size-small .turtle-stage { align-items: flex-end; padding: 0 24px 24px 0; }
body.size-small .turtle-img   { width: 32vw; max-height: 38vh; }
body.size-small .giraffe-stage { justify-content: flex-end; padding: 0 24px 0 0; }
body.size-small .giraffe-img   { width: 22vw; max-height: 55vh; }
```

IPC `character:set-size` 로 즉시 반영 (재시작 불필요).

### 4.11 detector 창 닫기 1회 알림 (#8 기능)

```js
detectorWin.on('close', (e) => {
  if (isAppQuitting) return;
  e.preventDefault();
  detectorWin.hide();
  if (!store.get('hasShownCloseNotice')) {
    store.set('hasShownCloseNotice', true);
    notify('JJUUK 는 트레이에 머물고 있어요',
           '오른쪽 아래 트레이 아이콘을 누르면 다시 열 수 있어요.');
  }
});
```

### 4.12 캘리브레이션 사후 안내 (#6 디자인)

`calibration:done` 수신 시 1회 한정 Notification:
> JJUUK 가 트레이에서 자세를 봐 줄게요
> 카메라가 백그라운드에서 동작합니다. 트레이 아이콘으로 언제든 일시정지하세요.

---

## 5. UI / UX 변화

### 5.1 설정창 신규 섹션

순서대로:
1. **캐릭터 디자인** (기존, "Mommy" → "엄마 거북이 · 기린")
2. **알림 크기** ← 신규 (segmented: 보통 / 작게)
3. **감지 민감도** (기존)
4. **컴퓨터 켤 때 자동 실행** (기존)
5. **테마** ← 다크모드 토글 자리에 segmented(자동/라이트/다크) 로 교체
6. **오늘의 자세 리포트** ← 신규
   - 큰 숫자: 양호 X시간 Y분
   - 스택 가로바: 양호(초록) / 거북목(주황) / 굽은등(빨강) 비율
   - 범례: 각 상태 분 단위
   - 하단: 지난 7일 양호 비율
   - 데이터 없으면 "아직 기록이 없어요" 자리표시자
7. **내 자세 다시 측정하기** (기존 + 메타: "3일 전에 측정함", stale 시 "권장" 배지)

설정창 푸터에 🔒 개인정보 안내 1줄 고정.

설정창은 30초마다 통계 재요청 → 열어둔 채로도 수치가 움직임.

### 5.2 트레이 팝업

```
┌──────────────────────────┐
│ JJUUK 켜기        [●━○] │  토글
│ 자세 감지 중             │
├──────────────────────────┤
│ 자세 다시 측정  [권장] › │  ← 신규 행
├──────────────────────────┤
│ 설정                  ›  │
└──────────────────────────┘
```

`POPUP_CARD_CONTENT_HEIGHT` 99 → 144. `baseline.stale` 면 "권장" 배지 표시.

### 5.3 캘리브레이션 화면

추가된 요소 (init/ready 페이즈에서만 노출):

```
[ 어깨를 펴고 등을 의자에 붙여요 ]
[ 턱은 살짝 당기고 머리는 정면을 향해요 ]
[ 이 자세가 앞으로의 기준이 됩니다 ]
```

화면 하단 고정 1줄:
> 🔒 카메라 영상은 컴퓨터 안에서만 처리되며, 어디에도 저장·전송되지 않아요.

카메라 실패 시 preview 위에 검은 패널 + 친절 메시지 + [다시 시도] [OS 카메라 설정 열기].

윈도우 높이 614 → 720 (max), 660 (min) — 신규 hints + 푸터 수용.

---

## 6. 새/변경된 IPC

| 채널 | 방향 | 용도 |
|---|---|---|
| `stats:get` | renderer ↔ main (handle) | 일별 통계 N일치 조회 |
| `app:get-baseline-meta` | renderer ↔ main (handle) | `{exists, createdAt, stale}` |
| `app:open-camera-settings` | renderer → main | OS 카메라 설정 페이지 열기 |
| `settings:set-theme-mode` | renderer → main | system/light/dark |
| `settings:set-notification-size` | renderer → main | normal/small |
| `character:set-size` | main → overlay | size 클래스 토글 |
| `settings:set-theme` | (deprecated) | 구버전 호환만 유지 |

`settings:get` 응답 스키마 확장:
```diff
{
  sensitivity, active, openAtLogin, characterDesign,
- theme,
+ themeMode, effectiveTheme,
+ notificationSize,
+ baseline: { exists, createdAt, stale },
+ platform: 'darwin' | 'win32' | ...
}
```

---

## 7. 파일별 변경량

| 파일 | 변경 |
|---|---|
| `shared/config.js` | + 5 상수 |
| `main/main.js` | overlay Map, stats, native theme, tray menu, notifications, IPC 7종 추가 — 사실상 전체 재구성 |
| `main/preload.js` | API 5종 추가 (setNotificationSize, setThemeMode, getStats, getBaselineMeta, openCameraSettings, onCharacterSize) |
| `renderer/detector/detector.js` | 다중 얼굴 선택, 거북목 규칙 변경, 분산 체크, camera-error phase, hint 토글 |
| `renderer/detector/detector.html` | camera error 패널, calib hints, privacy 푸터, 새 CSS 100여 줄 |
| `renderer/overlay/overlay.css` | size-small 분기 |
| `renderer/overlay/overlay.js` | onCharacterSize 리스너 |
| `renderer/settings/settings.html` | segmented control, stats card, baseline meta, 푸터 — 전체 재구성 |
| `renderer/settings/settings.js` | segmented/stats/baseline 로직 추가 |
| `renderer/tray-popup/popup.html` | 3 rows, stale 배지 스타일 |
| `renderer/tray-popup/popup.js` | recalibrate 핸들러, baseline 메타 fetch |

---

## 8. 마이그레이션 / 하위 호환

기존 사용자(electron-store 에 v0.1 데이터 있음) 경험:

| 항목 | 동작 |
|---|---|
| `theme: 'dark'` 로 저장돼 있던 사람 | `themeMode: 'dark'` 로 자동 매핑 |
| 처음 부팅하는 신규 사용자 | `themeMode: 'system'` (OS 따라감) |
| baseline 만 있고 createdAt 없는 사람 | 첫 부팅 시점이 createdAt 으로 도장. 14일 후 "재측정 권장" 자연 발생 |
| `stats` 없음 | 빈 객체로 시작, 점진 누적 |
| 알림 사이즈 미지정 | `normal` (기존 풀스크린 동작 유지) |
| `settings:set-theme` IPC 호출하던 구 코드 | 여전히 동작 (themeMode 로 내부 매핑) |

---

## 9. 검증 체크리스트 (수동)

| 항목 | 어떻게 확인 |
|---|---|
| 멀티 모니터 오버레이 | 두 화면 연결 → 자세 흐트러뜨려 양쪽 동시 등장 확인 |
| 디스플레이 핫플러그 | 모니터 케이블 뽑았다 꽂기 → 오버레이 재배치 |
| 거북목/굽은등 양쪽 발생 | 의도적으로 둘 다 해보고 기린/거북이 둘 다 나오는지 |
| 다중 얼굴 | 옆에 사람 한 명 같이 앉기 → 본인 기준으로만 판정 |
| 캘리브레이션 분산 | 측정 중 일부러 앞뒤로 움직이기 → "흔들렸어요" 안내 |
| 카메라 에러 패널 | OS 카메라 권한 끄고 앱 실행 → 패널 + "OS 설정 열기" 동작 |
| 시스템 다크모드 | themeMode=자동 상태에서 OS 라이트↔다크 토글 |
| 알림 크기 작게 | 설정에서 변경 → 거북이가 우하단 코너에 작게 |
| 트레이 우클릭 | Windows 네이티브 컨텍스트 메뉴 |
| 트레이 툴팁 | 마우스 호버 → "자세 감지 중" / "일시정지됨" 동적 |
| 통계 카드 | 자세 흐트러뜨린 뒤 설정 열기 → 분/비율 갱신 |
| baseline stale | electron-store 직접 편집해 `createdAt` 을 15일 전으로 → 배지 + 툴팁 |
| detector 창 X | 첫 닫기 시 Windows 토스트 1회 |
| 캘리브레이션 사후 | "이대로 좋아요" 직후 토스트 1회 |
| 개인정보 푸터 | 측정 화면 / 설정 푸터 둘 다 표시 |

---

## 10. 의도적으로 안 한 것

| 항목 | 이유 |
|---|---|
| 알림 빈도/일일 한도 설정 | 사용자 요청에서 제외 |
| 다국어 지원 | 사용자 요청에서 제외 |
| 트레이 아이콘 자체의 active/paused 시각 변형 | 별도 아이콘 asset 필요. 툴팁 + 팝업 상태 텍스트로 대체 |
| 통계 차트 (라인/막대 차트) | 카드형 요약으로 충분. 시각화 라이브러리 의존 회피 |
| 캘리브레이션 무효 시 raw 표본 보존 | 단순 폐기로 유지 (의도) |

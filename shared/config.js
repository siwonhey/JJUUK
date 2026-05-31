// 민감도 → threshold 매핑 (사용자가 트레이 메뉴에서 조절)
// faceWidthRatio: baseline 대비 얼굴 크기 비율. > threshold → 거북목
// faceYDelta: baseline 대비 얼굴 중심 Y 변화량 (정규화). > threshold → 굽은 자세
//
// 낮을수록 민감 (조금만 움직여도 캐릭터 등장), 높을수록 둔감
const SENSITIVITY_PRESETS = {
  low:    { faceWidthRatio: 1.25, faceYDelta: 0.08 },   // 둔감
  normal: { faceWidthRatio: 1.15, faceYDelta: 0.05 },   // 기본
  high:   { faceWidthRatio: 1.08, faceYDelta: 0.03 },   // 민감
};

// 자세 이상 → 캐릭터 등장 사이에 hysteresis (잦은 토글 방지)
const DEBOUNCE_MS = 700;

// 자세 복귀로 판정할 때는 threshold의 90% 이하로 떨어져야 (히스테리시스)
const RECOVERY_RATIO = 0.9;

// 거북목 vs "단순히 모니터에 가까이" 구분용 — yDelta 가 이 값 이하일 때만 거북목으로 인정.
// 거북목은 얼굴 폭은 늘되 Y중심 변화는 거의 없음. 단순 다가가기는 둘 다 늘어남.
// baseline 의 faceYDelta 임계치보다 살짝 큰 값(0.6배)을 허용해 정상 미세 흔들림 흡수.
const TURTLE_NECK_Y_TOLERANCE_FACTOR = 0.6;

// baseline 신선도 — 이 값 초과 시 재측정 권장 배지/문구 노출
const RECALIBRATION_RECOMMEND_DAYS = 14;

// 오버레이 알림 크기 — 'normal' 은 기존 풀스크린 임팩트, 'small' 은 코너 미니멀
const NOTIFICATION_SIZES = ['normal', 'small'];
const DEFAULT_NOTIFICATION_SIZE = 'normal';

// 테마 모드 — 'system' 은 OS 다크모드 따라감
const THEME_MODES = ['light', 'dark', 'system'];
const DEFAULT_THEME_MODE = 'system';

// 통계 보관 일수 — 이 일수 초과한 일별 버킷은 자동 정리
const STATS_RETENTION_DAYS = 30;

module.exports = {
  SENSITIVITY_PRESETS,
  DEBOUNCE_MS,
  RECOVERY_RATIO,
  TURTLE_NECK_Y_TOLERANCE_FACTOR,
  RECALIBRATION_RECOMMEND_DAYS,
  NOTIFICATION_SIZES,
  DEFAULT_NOTIFICATION_SIZE,
  THEME_MODES,
  DEFAULT_THEME_MODE,
  STATS_RETENTION_DAYS,
};

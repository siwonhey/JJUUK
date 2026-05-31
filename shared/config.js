// 민감도 → threshold 매핑 (사용자가 트레이 메뉴에서 조절)
// faceWidthRatio: baseline 대비 얼굴 크기 비율. > threshold → 거북목
// faceYDelta: baseline 대비 얼굴 중심 Y 변화량 (정규화). > threshold → 굽은 자세
//
// 낮을수록 민감 (조금만 움직여도 캐릭터 등장), 높을수록 둔감
const SENSITIVITY_PRESETS = {
  low:    { faceWidthRatio: 1.25, faceYDelta: 0.08 },   // 둔감
  normal: { faceWidthRatio: 1.13, faceYDelta: 0.05 },   // 기본 — 거북목 살짝 더 예민하게 (1.15 → 1.13)
  high:   { faceWidthRatio: 1.08, faceYDelta: 0.03 },   // 민감
};

// 자세 이상 → 캐릭터 등장 사이에 hysteresis (잦은 토글 방지)
const DEBOUNCE_MS = 700;

// 자세 복귀로 판정할 때는 threshold의 90% 이하로 떨어져야 (히스테리시스)
const RECOVERY_RATIO = 0.9;

// 거북목 vs 굽은 등 분기 — Y 가 임계치의 이 배수 이상으로 압도적으로 클 때만 slouch 가 turtle-neck 을 이김.
// 거북목 자세에서도 머리가 살짝 내려가 yDelta 가 임계치를 살짝 넘는 경우가 흔한데,
// 너무 엄격하게 자르면 진짜 거북목이 기린으로 잘못 분류됨. 1.5배 여유로 그 케이스 흡수.
const SLOUCH_OVERRIDE_FACTOR = 1.5;

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
  SLOUCH_OVERRIDE_FACTOR,
  RECALIBRATION_RECOMMEND_DAYS,
  NOTIFICATION_SIZES,
  DEFAULT_NOTIFICATION_SIZE,
  THEME_MODES,
  DEFAULT_THEME_MODE,
  STATS_RETENTION_DAYS,
};

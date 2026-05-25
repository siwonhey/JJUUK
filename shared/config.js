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

module.exports = { SENSITIVITY_PRESETS, DEBOUNCE_MS, RECOVERY_RATIO };

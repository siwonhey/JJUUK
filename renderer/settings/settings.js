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

const slider = document.getElementById('slider');
const desc   = document.getElementById('desc');
const labels = document.querySelectorAll('.slider-labels span');
const openAtLoginToggle = document.getElementById('open-at-login');
const darkModeToggle = document.getElementById('dark-mode');

const designSelect = document.getElementById('design-select');
const previewTurtle  = document.getElementById('preview-turtle');
const previewGiraffe = document.getElementById('preview-giraffe');

const VALID_DESIGNS = ['realistic', 'clay', 'cube', 'lowpoly'];

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

function render(value) {
  desc.textContent = LEVELS[value].desc;
  labels.forEach((el) => {
    el.classList.toggle('active', Number(el.dataset.level) === Number(value));
  });
  // 라벨 위치는 폰트 로딩/리사이즈로 바뀔 수 있어 매번 재계산
  positionArrow(value);
}

(async function init() {
  const settings = await window.jjuuk.getSettings();
  const value = NAME_TO_VALUE[settings.sensitivity] || 2;
  slider.value = value;
  render(value);
  openAtLoginToggle.checked = !!settings.openAtLogin;

  const initialDesign = VALID_DESIGNS.includes(settings.characterDesign)
    ? settings.characterDesign
    : 'realistic';
  designSelect.value = initialDesign;
  applyDesignPreview(initialDesign);

  // 테마 — main 이 did-finish-load 에 보내주지만 race 방지 위해 초기값도 즉시 반영
  const initialTheme = settings.theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('dark', initialTheme === 'dark');
  darkModeToggle.checked = initialTheme === 'dark';
})();

slider.addEventListener('input', () => {
  const value = Number(slider.value);
  render(value);
  window.jjuuk.setSensitivity(LEVELS[value].name);
});

openAtLoginToggle.addEventListener('change', () => {
  window.jjuuk.setOpenAtLogin(openAtLoginToggle.checked);
});

document.getElementById('recalibrate-btn').addEventListener('click', () => {
  window.jjuuk.recalibrate();
});

designSelect.addEventListener('change', () => {
  const design = designSelect.value;
  applyDesignPreview(design);
  // 오버레이에도 즉시 반영
  window.jjuuk.setCharacterDesign(design);
});

darkModeToggle.addEventListener('change', () => {
  const theme = darkModeToggle.checked ? 'dark' : 'light';
  document.body.classList.toggle('dark', theme === 'dark');
  window.jjuuk.setTheme(theme);
});

window.jjuuk.onTheme((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
  darkModeToggle.checked = theme === 'dark';
});


// Pretendard 가 늦게 로드되면 라벨 폭이 바뀌어 화살표가 어긋날 수 있음
window.addEventListener('load', () => positionArrow(Number(slider.value)));
if (document.fonts?.ready) {
  document.fonts.ready.then(() => positionArrow(Number(slider.value)));
}

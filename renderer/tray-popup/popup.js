const toggle = document.getElementById('active-toggle');
const statusEl = document.getElementById('status');

function render(active) {
  toggle.checked = !!active;
  statusEl.textContent = active ? '자세 감지 중' : '일시정지됨';
}

(async function init() {
  const active = await window.jjuuk.getActive();
  render(active);
})();

toggle.addEventListener('change', () => {
  window.jjuuk.setActive(toggle.checked);
  render(toggle.checked);
});

document.getElementById('open-settings').addEventListener('click', () => {
  window.jjuuk.openSettings();
});

// 카드 영역 기준 hover 감지.
// 윈도우는 작업표시줄을 가두려 화면 하단까지 늘려놨기 때문에 body 기반으로 검사하면
// 카드 밖으로 벗어나도 윈도우 안이라 안 닫힌다. 그래서 카드의 bounding rect 와 비교.
const card = document.querySelector('.card');
let hasEnteredCard = false;
let hideTimer = null;

function startHide() {
  if (hideTimer) return;
  hideTimer = setTimeout(() => window.jjuuk.closePopup(), 250);
}
function cancelHide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
}

document.body.addEventListener('mousemove', (e) => {
  const r = card.getBoundingClientRect();
  const inCard =
    e.clientX >= r.left && e.clientX <= r.right &&
    e.clientY >= r.top  && e.clientY <= r.bottom;
  if (inCard) {
    hasEnteredCard = true;
    cancelHide();
  } else if (hasEnteredCard) {
    startHide();
  }
});

// 윈도우 자체를 벗어나는 경우(휙 빠른 이동)도 보호
document.body.addEventListener('mouseleave', () => {
  if (hasEnteredCard) startHide();
});

window.jjuuk.onPopupShown(async () => {
  hasEnteredCard = false;
  cancelHide();
  const active = await window.jjuuk.getActive();
  render(active);
});

window.jjuuk.onTheme((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});

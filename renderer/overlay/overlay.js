// posture:state 이벤트 → 거북이/기린 등장/퇴장 토글
const turtle = document.querySelector('.turtle-slider');
const giraffe = document.querySelector('.giraffe-slider');
const turtleImg = document.getElementById('turtle-img');
const giraffeImg = document.getElementById('giraffe-img');

let currentState = 'good';

function setDesign(design) {
  // 잘못된 값이 와도 깨지지 않게 realistic 로 폴백
  const safe = ['realistic', 'clay', 'cube', 'lowpoly', 'mommy'].includes(design) ? design : 'realistic';
  turtleImg.src = `../../assets/characters/${safe}/turtle.png`;
  giraffeImg.src = `../../assets/characters/${safe}/giraffe.png`;
}

function setSize(size) {
  // 'normal' (기본 풀스크린 임팩트) | 'small' (코너 미니멀)
  document.body.classList.toggle('size-small', size === 'small');
}

function setState(state) {
  if (state === currentState) return;
  currentState = state;
  turtle.classList.toggle('visible', state === 'turtle-neck');
  giraffe.classList.toggle('visible', state === 'slouch');
}

window.jjuuk.onPostureState((s) => setState(s));
window.jjuuk.onCharacterHide(() => setState('good'));
window.jjuuk.onCharacterDesign((d) => setDesign(d));
window.jjuuk.onCharacterSize?.((s) => setSize(s));

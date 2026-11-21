import { paused as motionPaused } from './motion.js';

const cube = document.getElementById('hero-cube');
const stage = cube.closest('.cube-visual');

const faces = [
  ['front', 2, 1], ['back', 2, -1], ['right', 0, 1],
  ['left', 0, -1], ['bottom', 1, 1], ['top', 1, -1],
];
const cubies = [];
let paused = motionPaused;
let move = 0;
let timer;
let animation;
const moves = [[1, -1, 1], [0, 1, -1], [2, 1, 1], [1, 1, -1], [0, -1, 1], [2, -1, -1]];

function place(piece) {
  const [x, y, z] = piece.position;
  piece.element.style.transform = 'translate3d(calc(var(--step) * ' + x + '), calc(var(--step) * ' +
    y + '), calc(var(--step) * ' + z + ')) ' + piece.orientation.toString();
}

for (const x of [-1, 0, 1]) {
  for (const y of [-1, 0, 1]) {
    for (const z of [-1, 0, 1]) {
      if (x === 0 && y === 0 && z === 0) continue;
      const position = [x, y, z];
      const element = document.createElement('div');
      element.className = 'cube-piece';
      for (const [face, axis, side] of faces) {
        const panel = document.createElement('span');
        panel.className = 'cube-face cube-face-' + face;
        panel.classList.toggle('sticker', position[axis] === side);
        element.append(panel);
      }
      const piece = { element, position, orientation: new DOMMatrix() };
      place(piece);
      cube.append(element);
      cubies.push(piece);
    }
  }
}

function schedule() {
  clearTimeout(timer);
  if (!paused && !animation) timer = setTimeout(turn, 1450);
}

function turn() {
  if (paused) return;
  if (document.hidden || stage.hidden || !stage.getClientRects().length) {
    schedule();
    return;
  }
  const [axis, layer, direction] = moves[move++ % moves.length];
  const selected = cubies.filter(piece => piece.position[axis] === layer);
  const slice = document.createElement('div');
  slice.className = 'cube-slice';
  cube.append(slice);
  for (const piece of selected) slice.append(piece.element);
  const rotation = 'rotate' + 'XYZ'[axis] + '(' + direction * 90 + 'deg)';
  animation = slice.animate([{ transform: 'none' }, { transform: rotation }], {
    duration: 720, easing: 'cubic-bezier(.55,.08,.24,1)', fill: 'forwards',
  });
  animation.onfinish = () => {
    const angles = [0, 0, 0];
    angles[axis] = direction * 90;
    const matrix = new DOMMatrix().rotate(...angles);
    for (const piece of selected) {
      const point = matrix.transformPoint(new DOMPoint(...piece.position));
      piece.position = [point.x, point.y, point.z].map(Math.round);
      piece.orientation = matrix.multiply(piece.orientation);
      place(piece);
      cube.append(piece.element);
    }
    slice.remove();
    animation = null;
    schedule();
  };
}

function setPaused(value) {
  paused = value;
  if (animation) {
    if (value) animation.pause();
    else animation.play();
  }
  schedule();
}

document.addEventListener('prashi-motion-change', () => setPaused(motionPaused));
setPaused(motionPaused);

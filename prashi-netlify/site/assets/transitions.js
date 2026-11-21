import { paused } from './motion.js';

const storageKey = 'prashi-pixel-transition';
const currentPage = () => location.pathname + location.search;
const knownPage = /^\/(?:|login\/?|portal\/?|admin\/?|privacy(?:\.html|\/)?|terms(?:\.html|\/)?|courses\/[a-z0-9-]+\/?|resources\/[a-z0-9-]+\/?)$/;
let layer;
let moving = false;
let animations = [];

function clearTiles() {
  for (const animation of animations) animation.cancel();
  animations = [];
  layer?.remove();
  layer = null;
}

function pixels(reveal) {
  clearTiles();
  const columns = Math.max(5, Math.ceil(innerWidth / 82));
  const cellSize = innerWidth / columns;
  const rows = Math.ceil(innerHeight / cellSize);
  layer = document.createElement('div');
  layer.className = 'page-pixels';
  layer.setAttribute('aria-hidden', 'true');
  layer.style.setProperty('--pixel-columns', columns);
  layer.style.setProperty('--pixel-size', cellSize + 'px');
  const tiles = document.createDocumentFragment();
  const layout = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const tile = document.createElement('span');
      const stamp = row * 11 + col * 17;
      tile.className = 'page-pixel page-pixel-' + stamp % 4;
      const fromEdge = (reveal ? columns - 1 - col : col) / Math.max(1, columns - 1);
      const fromBottom = (rows - 1 - row) / Math.max(1, rows - 1);
      const delay = Math.round(fromEdge * 150 + fromBottom * 65 + (stamp % 28));
      tiles.append(tile);
      layout.push([tile, delay]);
    }
  }
  layer.dataset.state = reveal ? 'covered' : 'clear';
  layer.append(tiles);
  document.body.append(layer);
  const opacity = reveal ? [1, 0] : [0, 1];
  animations = layout.map(([tile, delay]) => tile.animate(
    [{ opacity: opacity[0] }, { opacity: opacity[1] }],
    { duration: 90, delay, easing: 'steps(1, end)', fill: 'both' },
  ));
  return Promise.allSettled(animations.map(animation => animation.finished));
}

function resumeArrival() {
  let previous;
  try {
    previous = JSON.parse(sessionStorage.getItem(storageKey));
    sessionStorage.removeItem(storageKey);
  } catch {}
  if (paused || previous?.page !== currentPage() || Date.now() - previous.time > 10000) return false;
  pixels(true).then(clearTiles);
  return true;
}

function follow(event) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || paused) return;
  const link = event.target.closest?.('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target.toLowerCase() !== '_self')) return;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !knownPage.test(url.pathname) || url.pathname + url.search === currentPage()) return;
  if (typeof Element.prototype.animate !== 'function') return;
  event.preventDefault();
  if (moving) return;
  moving = true;
  pixels(false).then(() => {
    if (!paused) {
      try { sessionStorage.setItem(storageKey, JSON.stringify({ page: url.pathname + url.search, time: Date.now() })); } catch {}
    }
    location.assign(url.href);
  });
}

export const pixelArrival = typeof Element.prototype.animate === 'function' && resumeArrival();
document.addEventListener('click', follow);
document.addEventListener('prashi-motion-change', () => {
  if (paused) clearTiles();
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  clearTiles();
  moving = false;
});

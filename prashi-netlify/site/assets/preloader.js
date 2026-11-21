import { paused } from './motion.js';
import { pixelArrival } from './transitions.js';

function makeLoader() {
  const loader = document.createElement('div');
  loader.className = 'academic-preloader';
  loader.setAttribute('aria-hidden', 'true');

  const orbit = document.createElement('div');
  orbit.className = 'preloader-orbit';
  for (let index = 0; index < 3; index++) {
    const ring = document.createElement('span');
    ring.className = 'preloader-ring';
    orbit.append(ring);
  }
  ['π', '∑', '⚛︎', '∫'].forEach(value => {
    const symbol = document.createElement('span');
    symbol.className = 'preloader-symbol';
    symbol.textContent = value;
    orbit.append(symbol);
  });

  const brand = document.createElement('span');
  brand.className = 'preloader-brand';
  brand.textContent = 'Prashi Tutorial';
  loader.append(orbit, brand);
  return loader;
}

export function preloadPage(contentReady) {
  if (paused || pixelArrival) return;
  const loaded = document.readyState === 'complete' ? Promise.resolve()
    : new Promise(resolve => window.addEventListener('load', resolve, { once: true }));
  let loader;
  let timeout;
  const show = setTimeout(() => {
    if (paused) return;
    loader = makeLoader();
    document.body.append(loader);
  }, 100);
  const safety = new Promise(resolve => { timeout = setTimeout(resolve, 2400); });

  function finish() {
    clearTimeout(show);
    clearTimeout(timeout);
    document.removeEventListener('prashi-motion-change', onMotionChange);
    if (!loader) return;
    const element = loader;
    loader = null;
    if (paused) {
      element.remove();
      return;
    }
    element.classList.add('preloader-leaving');
    element.addEventListener('transitionend', () => element.remove(), { once: true });
    setTimeout(() => element.remove(), 280);
  }

  function onMotionChange() {
    if (paused) finish();
  }
  document.addEventListener('prashi-motion-change', onMotionChange);
  Promise.race([Promise.allSettled([loaded, contentReady]), safety]).then(finish);
}

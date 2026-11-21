const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const controls = document.querySelectorAll('[data-motion-toggle]');
const key = 'prashi-motion';
let choice;
try { choice = localStorage.getItem(key); } catch {}
export let paused;

function update() {
  paused = choice ? choice === 'paused' : motionPreference.matches;
  document.documentElement.classList.toggle('motion-paused', paused);
  document.documentElement.classList.toggle('motion-enabled', !paused);
  for (const button of controls) {
    button.textContent = paused ? 'Play animation' : 'Pause animation';
    button.hidden = false;
  }
  document.dispatchEvent(new Event('prashi-motion-change'));
}

for (const button of controls) button.addEventListener('click', () => {
  choice = paused ? 'playing' : 'paused';
  try { localStorage.setItem(key, choice); } catch {}
  update();
});
motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) {
    choice = null;
    try { localStorage.removeItem(key); } catch {}
  }
  update();
});
update();

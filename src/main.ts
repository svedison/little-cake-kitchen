import './style.css';
import { Kitchen } from './kitchen';
import { EggStep } from './eggs';
import { sound } from './sound';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('c');
const title = $('title');
const start = $<HTMLButtonElement>('start');
const loading = $('loading');
const hud = $('hud');
const hint = $('hint');
const stepTitle = $('step-title');
const pips = $('pips');
const again = $<HTMLButtonElement>('again');
const mute = $<HTMLButtonElement>('mute');

start.disabled = true;

const kitchen = await Kitchen.create(canvas);
const step = new EggStep(kitchen, {
  onProgress(cracked, total) {
    pips.querySelectorAll('span').forEach((p, i) => p.classList.toggle('on', i < cracked));
    if (cracked > 0 && cracked < total) hint.textContent = cracked === 1 ? 'Lovely! Two more.' : 'One more!';
    if (cracked === 0) { hint.textContent = 'Pick up an egg and knock it on the edge of the bowl'; again.hidden = true; stepTitle.textContent = 'Crack the eggs'; }
  },
  onDone() {
    stepTitle.textContent = 'Ta-da!';
    hint.textContent = 'Three eggs in the bowl. That is the whole slice for now.';
    again.hidden = false;
  },
});

for (let i = 0; i < step.total; i++) pips.appendChild(document.createElement('span'));

loading.textContent = '';
start.disabled = false;

start.addEventListener('click', () => {
  sound.unlock();
  title.classList.add('away');
  hud.hidden = false;
  mute.hidden = false;
  kitchen.start();
});

again.addEventListener('click', () => step.reset());

mute.addEventListener('click', () => {
  const m = !sound.muted;
  sound.setMuted(m);
  mute.textContent = m ? '🔇' : '🔊';
  mute.setAttribute('aria-pressed', String(m));
  mute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
});

// ?fps shows a frame counter for tuning on a real phone.
if (new URLSearchParams(location.search).has('fps')) {
  const el = document.createElement('div');
  el.id = 'fps';
  document.body.appendChild(el);
  setInterval(() => { el.textContent = `${Math.round(kitchen.fps)} fps`; }, 500);
}

// Hooks for the headless test driver.
(window as unknown as { __slice: unknown }).__slice = {
  screen: () => step.screen(),
  state: () => ({ cracked: step.cracked, landed: step.landed, fps: kitchen.fps }),
  reset: () => step.reset(),
};

import './style.css';
import { Kitchen } from './kitchen';
import { Hud } from './hud';
import { Game } from './game';
import { sound } from './sound';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('c');
const title = $('title');
const start = $<HTMLButtonElement>('start');
const loading = $('loading');
const mute = $<HTMLButtonElement>('mute');

start.disabled = true;

const kitchen = await Kitchen.create(canvas);
const hud = new Hud();
const game = new Game(kitchen, hud);

loading.textContent = '';
start.disabled = false;

start.addEventListener('click', () => {
  sound.unlock();
  title.classList.add('away');
  mute.hidden = false;
  kitchen.start();
  game.begin();
});

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
(window as unknown as { __game: unknown }).__game = {
  state: () => ({
    phase: game.phase,
    step: game.stepIndex,
    station: kitchen.rail.current,
    settled: kitchen.rail.settled,
    results: [...game.results],
    cakes: game.gallery.length,
    verdict: game.gallery.at(-1)?.verdict ?? null,
    fps: kitchen.fps,
  }),
  targets: () => Object.fromEntries(Object.entries(game.targets()).map(([k, v]) => [k, kitchen.toScreen(v)])),
  startRecipe: (flavor: string) => game.startRecipe(game.flavor.id === flavor ? game.flavor : (['classic', 'blueberry', 'lemon'].includes(flavor) ? { ...game.flavor, id: flavor as 'classic', name: flavor, chip: '', addIn: flavor === 'blueberry' ? 'berries' : flavor === 'lemon' ? 'lemon' : undefined } : game.flavor)),
  goTo: (id: 'fridge' | 'counter' | 'stove') => kitchen.rail.goTo(id),
};

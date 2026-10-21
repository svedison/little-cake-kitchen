import './style.css';
import type * as THREE from 'three';
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

// ---- hooks for the headless test driver (test/play.cjs) ------------------------------

// The rail's biggest per-frame move is measured per Step, so reset it whenever one starts.
let lastStep = game.stepIndex;
kitchen.updaters.add(() => {
  if (game.stepIndex !== lastStep) { lastStep = game.stepIndex; kitchen.resetRailStats(); }
});

const rect = (sel: string, onlyIfShown = false) => {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el) return null;
  if (onlyIfShown && (el.hidden || el.style.visibility === 'hidden')) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};

const boxes = () => {
  const props: Record<string, { world: { min: number[]; max: number[] }; screen: { x: number; y: number; w: number; h: number }; parent?: string }> = {};
  const objs = game.boxes();
  for (const [name, obj] of Object.entries(objs)) {
    const b = kitchen.boxOf(obj);
    if (!b) continue;
    // A prop drawn as part of another (the oven door) is marked so the driver can skip the pair.
    const parent = Object.entries(objs).find(([n, o]) => n !== name && o !== obj && isAncestor(o, obj))?.[0];
    props[name] = parent ? { ...b, parent } : b;
  }
  return {
    props,
    hud: { stepHead: rect('#step-head', true), foot: rect('.foot'), bubble: rect('#bubble', true) },
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
};

function isAncestor(a: THREE.Object3D, b: THREE.Object3D) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

const probe = () => {
  const p = game.current?.progress?.();
  const fill = game.pan.getObjectByName('fill') as THREE.Mesh | undefined;
  const door = game.oven.getObjectByName('door');
  const head = kitchen.toScreen(game.cat.headSide());
  return {
    stage: p?.stage ?? null,
    progress: p?.progress ?? 0,
    fillHex: fill ? `#${(fill.material as THREE.MeshStandardMaterial).color.getHexString()}` : null,
    doorOpen: door ? door.rotation.x / 1.5 : 0,
    catOnScreen: head.x >= 0 && head.x <= window.innerWidth && head.y >= 0 && head.y <= window.innerHeight,
    bubbleVisible: hud.bubbleVisible,
    ringDisplay: getComputedStyle($('ring')).display,
  };
};

(window as unknown as { __game: unknown }).__game = {
  state: () => {
    const p = game.current?.progress?.();
    return {
      phase: game.phase,
      step: game.stepIndex,
      station: kitchen.rail.current,
      settled: kitchen.rail.settled,
      results: [...game.results],
      cakes: game.gallery.length,
      verdict: game.gallery.at(-1)?.verdict ?? null,
      fps: kitchen.fps,
      progress: p?.progress ?? 0,
      stage: p?.stage ?? null,
      transition: null,
      railMaxStepDx: kitchen.railMaxStepDx,
      eatT: game.eatProgress,
      nudges: 0,
      ...(game.current?.debug?.() ?? {}),
    };
  },
  debug: () => game.current?.debug?.() ?? {},
  boxes,
  meter: () => game.current?.meterInfo?.() ?? null,
  probe,
  sounds: () => ({ log: [], loops: {}, loaded: [] }),
  nudges: 0,
  targets: () => Object.fromEntries(Object.entries(game.targets()).map(([k, v]) => [k, kitchen.toScreen(v)])),
  startRecipe: (flavor: string) => game.startRecipe(game.flavor.id === flavor ? game.flavor : (['classic', 'blueberry', 'lemon'].includes(flavor) ? { ...game.flavor, id: flavor as 'classic', name: flavor, chip: '', addIn: flavor === 'blueberry' ? 'berries' : flavor === 'lemon' ? 'lemon' : undefined } : game.flavor)),
  goTo: (id: 'fridge' | 'counter' | 'stove') => kitchen.rail.goTo(id),
  slowmo: (n: number) => { kitchen.slowmo = Math.max(1, n || 1); },
};

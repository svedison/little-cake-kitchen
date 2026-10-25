import './style.css';
import type * as THREE from 'three';
import { Vector3, Quaternion } from 'three';
import { Kitchen } from './kitchen';
import { STATION_X } from './camera';
import { Hud } from './hud';
import { Game } from './game';
import { BASQUE } from './recipes';
import { sound } from './sound';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const canvas = $<HTMLCanvasElement>('c');
const title = $('title');
const start = $<HTMLButtonElement>('start');
const loading = $('loading');
const mute = $<HTMLButtonElement>('mute');

const lost = $<HTMLButtonElement>('lost');

// The title card is honest about loading: Start stays pressed flat until the Kitchen has
// drawn its first frame, and the line under it says what is happening.
start.disabled = true;
loading.textContent = 'warming up the oven…';
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Stops this module here for good, without an error (the page has said why already). */
const halt = () => new Promise<never>(() => {});

// The canvas textures (Shelf cards, the oven's dial) are drawn once, so the font should be in
// first; a slow network gets 1.5 s and then the system font.
const fontsIn = Promise.race([document.fonts?.load('600 30px Fredoka').catch(() => {}), delay(1500)]);

let opened: Kitchen | null = null;
try {
  opened = await Kitchen.create(canvas); // Rapier's WebAssembly, then a WebGL context
} catch (e) {
  console.warn('the kitchen could not open:', e);
}
if (!opened) {
  // The 🥲 is drawn inline: Windows 10 has no glyph for it and would show a box.
  const face = '<svg class="emoji" role="img" aria-label="🥲" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffd45c" stroke="#e0a82e" stroke-width="1.2"/>'
    + '<path d="M6.8 10.2 Q8.4 8.6 10 10.2 M14 10.2 Q15.6 8.6 17.2 10.2" fill="none" stroke="#6b4a3a" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M8 14.2 Q12 17.8 16 14.2" fill="none" stroke="#6b4a3a" stroke-width="1.5" stroke-linecap="round"/>'
    + '<path d="M17.6 11.4 Q19.4 14 17.6 15 Q15.8 14 17.6 11.4 Z" fill="#7cc4f0"/></svg>';
  loading.innerHTML = `This browser can't open the kitchen ${face} Try Safari or Chrome`;
  loading.classList.add('fail');
  start.hidden = true;
}
const kitchen = opened ?? await halt();
loading.textContent = 'rolling out the dough…';
await Promise.all([fontsIn, nextFrame()]);

const hud = new Hud();
const game = new Game(kitchen, hud);
// Draw each Station once behind the title card, so shaders, shadow passes and canvas
// textures (the oven's dial and card) are ready and the first look at one never stalls.
kitchen.renderer.compile(kitchen.scene, kitchen.camera);
{
  const cam = kitchen.camera;
  const x = cam.position.x;
  for (const sx of [STATION_X.fridge, STATION_X.stove]) {
    cam.position.x = sx;
    cam.updateMatrixWorld();
    kitchen.renderer.render(kitchen.scene, cam);
  }
  cam.position.x = x;
  cam.updateMatrixWorld();
  kitchen.render(); // and the Counter, the first thing she sees
}
await nextFrame();

loading.textContent = '';
start.disabled = false;

// A phone can drop the WebGL context (memory pressure, a long time in the background). Ask to
// keep it, redraw once it is back, and offer a reload if it never comes back.
let lostTimer = 0;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  clearTimeout(lostTimer);
  lostTimer = window.setTimeout(() => { lost.hidden = false; }, 3000);
});
canvas.addEventListener('webglcontextrestored', () => {
  clearTimeout(lostTimer);
  lost.hidden = true;
  kitchen.render();
});
lost.addEventListener('click', () => location.reload());

start.addEventListener('click', () => {
  sound.unlock();
  title.classList.add('away');
  mute.hidden = false;
  kitchen.start();
  game.begin();
});

const showMuted = (m: boolean) => {
  mute.textContent = m ? '🔇' : '🔊';
  mute.setAttribute('aria-pressed', String(m));
  mute.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
};
showMuted(sound.muted); // remembered from the last visit
mute.addEventListener('click', () => {
  sound.setMuted(!sound.muted);
  showMuted(sound.muted);
});
// iOS suspends audio when the tab hides (or a call comes in); wake it on the way back.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sound.wake(); });

// ?fps shows a frame counter for tuning on a real phone.
if (new URLSearchParams(location.search).has('fps')) {
  const el = document.createElement('div');
  el.id = 'fps';
  document.body.appendChild(el);
  setInterval(() => { el.textContent = `${Math.round(kitchen.fps)} fps`; }, 500);
}

// ---- hooks for the headless test driver (test/play.cjs) ------------------------------

// The rail's biggest per-frame move is measured per Step, so reset it whenever one starts;
// so is the biggest per-frame turn of any of the Step's props (a carried thing must sway,
// never snap round).
let lastStep = game.stepIndex;
let maxRotDelta = 0;
const lastRot = new Map<THREE.Object3D, Quaternion>();
kitchen.updaters.add(() => {
  if (game.stepIndex !== lastStep) { lastStep = game.stepIndex; kitchen.resetRailStats(); maxRotDelta = 0; lastRot.clear(); }
  const seen = new Set<THREE.Object3D>();
  for (const obj of Object.values(game.current?.boxes?.() ?? {})) {
    if (!obj || !obj.visible) continue;
    seen.add(obj);
    const q = lastRot.get(obj);
    if (q) { maxRotDelta = Math.max(maxRotDelta, q.angleTo(obj.quaternion)); q.copy(obj.quaternion); }
    else lastRot.set(obj, obj.quaternion.clone());
  }
  for (const obj of lastRot.keys()) if (!seen.has(obj)) lastRot.delete(obj);
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
    // the meter ring inside the header (null while hidden): a held vessel may pass under the header's box, never the ring
    ring: document.getElementById('ring')?.hasAttribute('hidden') || document.getElementById('step-head')?.hidden ? null : rect('#ring'),
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
  const cakeTop = game.cake?.getObjectByName('top') as THREE.Mesh | undefined;
  const head = kitchen.toScreen(game.cat.headSide());
  return {
    stage: p?.stage ?? null,
    progress: p?.progress ?? 0,
    fillHex: fill ? `#${(fill.material as THREE.MeshStandardMaterial).color.getHexString()}` : null,
    doorOpen: door ? door.rotation.x / 1.5 : 0,
    /** The revealed cake's top, to compare with fillHex at the end of the bake. */
    cakeTopHex: cakeTop ? `#${(cakeTop.material as THREE.MeshStandardMaterial).color.getHexString()}` : null,
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
      transition: game.transition,
      /** Game seconds since the transition began (the previous Step's done). */
      transitionT: game.transitionT,
      time: kitchen.time,
      maxRotDelta,
      bowlY: game.bowl.group.position.y,
      bowlHomeY: game.bowl.home.y,
      carry: null,
      whiskTilt: null,
      lumps: null,
      lift: null,
      tilt: null,
      visible: null,
      railMaxStepDx: kitchen.railMaxStepDx,
      eatT: game.eatProgress,
      nudges: game.nudges,
      cue: game.cueName,
      cakeScale: game.cakeScale,
      cat: { expr: game.cat.expr, action: game.cat.action, chompT: game.cat.chompTime === Infinity ? null : game.cat.chompTime, headLean: game.cat.headLean },
      ...(game.current?.debug?.() ?? {}),
    };
  },
  debug: () => game.current?.debug?.() ?? {},
  boxes,
  meter: () => game.current?.meterInfo?.() ?? null,
  probe,
  /** The prop the finger is handling (its tight screen rect), the cat's face and the bubble, for the driver's room check. */
  room: () => game.roomInfo(),
  sounds: () => ({ log: [...sound.log], loops: sound.loops(), loaded: sound.loaded() }),
  audioState: () => sound.state,
  get nudges() { return game.nudges; },
  /** The finger cue's target name while it shows, else null; cueRect() is where it is drawn. */
  cue: () => game.cueName,
  /** Are the swipe chevrons at the screen edges showing. */
  chevrons: () => game.chevronsShown,
  cueRect: () => hud.cueRect,
  /** Every Step's hint for the recipe being baked (the driver checks they all name a gesture and a place). */
  stepHints: () => BASQUE.steps(game.flavor).map((d) => d.hint),
  targets: () => Object.fromEntries(Object.entries(game.targets()).map(([k, v]) => [k, kitchen.toScreen(v)])),
  startRecipe: (flavor: string) => game.startRecipe(game.flavor.id === flavor ? game.flavor : (['classic', 'blueberry', 'lemon'].includes(flavor) ? { ...game.flavor, id: flavor as 'classic', name: flavor, addIn: flavor === 'blueberry' ? 'berries' : flavor === 'lemon' ? 'lemon' : undefined } : game.flavor)),
  goTo: (id: 'fridge' | 'counter' | 'stove') => kitchen.rail.goTo(id),
  /** A world point in CSS pixels, for drivers sampling a spot of the Kitchen. */
  screenOf: (x: number, y: number, z: number) => kitchen.toScreen(new Vector3(x, y, z)),
  slowmo: (n: number) => { kitchen.slowmo = Math.max(1, n || 1); },
  /** The secret smashing: hits, breaks, what can break and how it is doing. */
  smash: () => game.smash.info(),
  catMood: () => ({ hits: game.catHits, pats: game.pats, strike: game.strike, sulking: game.cat.sulking, expr: game.cat.expr, face: kitchen.toScreen(game.cat.faceCentre()), body: kitchen.toScreen(game.cat.group.localToWorld(new Vector3(0, 0.05, 0))) }),
};

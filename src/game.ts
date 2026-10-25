// The flow: idle in the Kitchen with the recipe book, run a recipe Step by Step, reveal
// the cake, feed it to the cat, put it on the Shelf.
import * as THREE from 'three';
import { Kitchen, SLOT } from './kitchen';
import { STATION_X, type StationId } from './camera';
import { Bowl } from './bowl';
import { Cat, CHOMP } from './cat';
import { Hud } from './hud';
import { Carry, nudge } from './gestures';
import { Confetti } from './confetti';
import { makePan, makeOven, makeHob, makeCrock, makePlant, makeCanister, makeMitt, makeFridge, makeShelf, makeBook, makeCake, makeOtherCake, makeVerdictTag, makePlate, SHELF, FRIDGE } from './props';
import { motion, easeInOutCubic, easeOutCubic, easeOutBack } from './motion';
import { BASQUE, VERDICTS, CHEERS, displayName, type Flavor, type StepDef } from './recipes';
import { loadGallery, saveGallery, type CakeEntry } from './gallery';
import { sound } from './sound';
import { ease, type StepRunner, type Result, type Leftover } from './steps/step';
import type { PointerHandler } from './input';
import { Smash, type Kind } from './smash';

export const PLAYER_NAME = 'Creme';

type Phase = 'idle' | 'baking' | 'reveal';

/**
 * Between two Steps: the cat reacts to the one just done, its props tidy away, the view
 * moves to the next Station, and the next Step's props arrive. null while a Step runs.
 */
export type Transition = 'react' | 'leave' | 'move' | 'arrive' | null;

/** The beats of a transition (seconds). A Hold or Stir gets a longer look at how it came out. */
const BEAT = { react: 0.35, reactResult: 0.5, sameStation: 0.6, otherStation: 1.6, arrive: 1.2 };
/** What the cat says when a Hold or Stir came out under or over: never a telling-off. */
const SO_CLOSE = ['Close enough!', 'Still yummy!', 'Cute anyway!', 'That works!'];

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** Set once she has broken something for the first time (the cat's first gasp is the big one). */
const SMASHED_KEY = 'little-cake-kitchen.smashed';
/** What the cat cries when something breaks, by what it was. */
const SMASH_LINES: Record<string, string[]> = {
  tile: ['Not the tiles!!', 'Who is fixing that?!', 'The wall!! Mrrow!'],
  crock: ['My spoons!!', 'Nooo, my spatula!'],
  plant: ['BASIL! Noooo!', 'What did Basil ever do to you?!'],
  pot: ['That was my favourite pot!', 'Why the pot?!'],
  moka: ['My COFFEE!!', 'No more coffee for us...'],
  canister: ['The SUGAR!!', 'Sweep that up before the ants come!'],
  mitt: ['How do you even break a mitt?!', 'My mitt!!'],
  hob: ['The hob!? ...good thing we have an oven.', 'Okay that was kind of cool.'],
};
/** s between the cat's cries, however much breaks. */
const SMASH_TALK_GAP = 5;

/**
 * Taste-test timing (seconds): the cake reaches the mouth, then the cat's chomp (CHOMP in
 * cat.ts) takes it in three bites; each bite takes its third in 0.07 s, squashing as the jaws close.
 */
const EAT = { arrive: 0.3, bite: 0.07 };
/** What is left of the cake after each bite. */
const BITES = [0.66, 0.33, 0];
/** The cake is down to a crumb: the cat gulps. */
const GULP_AT = 0.1;

/** A pointer-down this close (px) to a prop or the cat Nudges it. */
const NUDGE_PX = 90;
/** The finger cue pulses on the Step's first target this long (s), or until the player grabs or holds. */
const CUE_T = 4;
/** The Stir cue circles the bowl's middle: this far out (px), this fast (rad/s); tuned by eye. */
const CUE_CIRCLE = { r: 42, speed: 4.5 };

/** Where a Step wants the first touch: the finger cue and the cat's point go there. */
export interface Cue { name: string; at: THREE.Vector3; circle?: boolean }
type Cued = StepRunner & { cue?(): Cue | null };

/**
 * The reveal (seconds): the pan rides from the oven to the bowl's slot alongside the camera,
 * the springform's latch flips open, then the ring lifts 6 cm off the cake and fades.
 */
const REVEAL = { ride: 0.9, rideArc: 0.05, latch: 0.18, lift: 0.5, ringRise: 0.06 };
/** The cake is out and nobody has picked it up for this long (s): the cat reaches for it. */
const TASTE_URGE_T = 6;

/** Set once the player has swiped between Stations; the edge chevrons never show again. */
const SWIPED_KEY = 'cremes-kitchen.swiped';
/** The Shelf holds the latest dozen; more than that and an "and N more" card opens the rest. */
const SHELF_MAX = SHELF.perRow * 2;
/**
 * The card hangs like a price tag from the front edge of the lower plank, in the middle: the
 * rows are full (six 6.6 cm cakes a row, 7.2 cm apart), so it sits under them and hides none.
 * Its top peeks 4 mm over the plank and it tips 0.08 rad (tuned by eye: a tag clipped on, not glued).
 */
const MORE_CARD = { size: [0.06, 0.04] as const, peek: 0.004, tilt: 0.08 };

const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* private mode: the hint just shows again next time */ } };

function cakeName(e: CakeEntry) {
  return e.recipe === 'basque' ? displayName(BASQUE, e.flavor) : e.recipe === 'tiramisu' ? 'Tiramisu' : 'Cream Puff';
}
function cakeDate(e: CakeEntry) {
  return new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** The little "and N more" card on the Shelf's lower plank (world size 0.06 x 0.04). */
function makeMoreCard(n: number) {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffb6c1';
  g.beginPath();
  g.roundRect(2, 2, 236, 156, 26);
  g.fill();
  g.fillStyle = '#fffdf6';
  g.beginPath();
  g.roundRect(12, 12, 216, 136, 18);
  g.fill();
  g.fillStyle = '#6b4a3a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '600 34px Fredoka, system-ui, sans-serif';
  g.fillText('and', 120, 52);
  g.font = '700 46px Fredoka, system-ui, sans-serif';
  g.fillText(`${n} more`, 120, 102);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const [w, h] = MORE_CARD.size;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, -h / 2, 0); // hanging from its top edge
  // A little self-lit so it reads in the plank's shadow (0.4 by eye: bright, never glowing).
  const card = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.4, roughness: 0.8, side: THREE.DoubleSide }));
  card.castShadow = true;
  card.name = 'more';
  return card;
}

export class Game {
  phase: Phase = 'idle';
  readonly bowl: Bowl;
  readonly cat: Cat;
  readonly pan = makePan();
  readonly oven = makeOven();
  readonly book = makeBook();
  readonly confetti: Confetti;
  gallery: CakeEntry[] = loadGallery();
  flavor: Flavor = BASQUE.flavors[0];
  stepIndex = -1;
  current: StepRunner | null = null;
  readonly results: (Result | undefined)[] = [];
  private steps: StepDef[] = [];
  private leftovers: Leftover[] = [];
  private shelfCakes: { obj: THREE.Group; entry: CakeEntry }[] = [];
  /** The "and N more" card, when there are more cakes than the Shelf holds. */
  private moreCard: THREE.Mesh | null = null;
  private readonly shelf = makeShelf();
  private readonly fridge = makeFridge();
  cake: THREE.Group | null = null;
  private feed: Carry | null = null;
  /** The cake just revealed; it goes in the gallery once the cat has tasted it (or the player moves on). */
  private lastEntry: CakeEntry | null = null;
  private lastSaved = true;
  /** Seconds the revealed cake has sat untouched, and whether the cat has asked for it yet. */
  private untouchedT = 0;
  private urged = false;
  private swipedBefore = readFlag(SWIPED_KEY);
  private eating = false;
  private eatT = 0;
  private eatFrom = new THREE.Vector3();
  private readonly biteDir = new THREE.Vector3(0, 0, 1);
  private chomping = false;
  private biteTo = 1;
  private cakeS = 1;
  private biteT = 99;
  private gulped = false;
  /** How many Nudges the player has had (for the test driver). */
  nudges = 0;
  /** The finger cue showing now (which target, how long it has left), null when none. */
  private cueNow: { name: string; left: number } | null = null;
  /** What the cat last pointed at, so it points again when the Step moves on to the next egg or vessel. */
  private pointed: string | null = null;
  /** Where the move between Steps is (see Transition), for the flow and the test driver. */
  transition: Transition = null;
  /** Game seconds since the transition started (the previous Step's done). */
  transitionT = 0;
  /** Bumped when a recipe starts or idle() runs, so a transition still in flight knows to stop. */
  private flow = 0;
  private waits: { until: () => boolean; left: number; resolve: () => void }[] = [];
  /** While the cat reacts and the props tidy away, a touch does nothing. */
  private readonly freeze: PointerHandler = { down: () => true, move() {}, up() {} };
  /** Bumped by idle() so a reveal still riding in knows it was cancelled. */
  private revealRun = 0;
  private unmolding = false;
  private readonly roomBox = new THREE.Box3();
  private readonly roomV = new THREE.Vector3();
  /** The plate left on the counter after the taste test, with the verdict stamp on it. */
  private plate: THREE.Group | null = null;
  /** The secret: anything she carries can smash the scenery (smash.ts). */
  readonly smash: Smash;
  private smashTalkT = Infinity;
  /** Lightbox pictures of Shelf cakes, by cake number. */
  private readonly thumbs = new Map<number, string>();

  constructor(readonly k: Kitchen, readonly hud: Hud) {
    this.bowl = new Bowl(k, SLOT.bowl.clone());
    this.cat = new Cat(k, hud, SLOT.cat.clone());
    this.pan.visible = false;
    k.scene.add(this.pan);
    this.oven.position.set(STATION_X.stove, 0, -0.2);
    k.scene.add(this.oven);
    // The hob stands to the oven's right, back against the tiles.
    const hob = makeHob();
    hob.position.set(STATION_X.stove + 0.36, 0, -0.38);
    hob.rotation.y = -0.15;
    k.scene.add(hob);
    // A crock of tools and a pot of basil at the back of the Counter, for the room to feel lived in.
    const crock = makeCrock();
    crock.position.set(0.15, 0, -0.38);
    crock.rotation.y = -0.4;
    k.scene.add(crock);
    const plant = makePlant();
    plant.position.set(-0.19, 0, -0.45);
    k.scene.add(plant);
    // A sugar canister and an oven mitt either side of the pan's spot at the Stove: a portrait
    // phone sees only the oven there, not the hob, so these keep something in reach on every screen.
    const canister = makeCanister();
    canister.position.set(STATION_X.stove - 0.13, 0, 0.065);
    k.scene.add(canister);
    const mitt = makeMitt();
    mitt.position.set(STATION_X.stove + 0.135, 0, 0.02);
    mitt.rotation.y = 0.5;
    k.scene.add(mitt);
    this.smash = new Smash(k, k.tiles, () => this.swinging(), { broke: (name, kind, at) => this.onSmash(name, kind, at) });
    this.smash.add('hob', hob.getObjectByName('hobBase')!, 'ceramic', 300);
    this.smash.add('pot', hob.getObjectByName('pot')!, 'ceramic', 200);
    this.smash.add('moka', hob.getObjectByName('moka')!, 'metal', 150);
    this.smash.add('crock', crock, 'ceramic', 150);
    this.smash.add('plant', plant, 'plant', 100);
    this.smash.add('canister', canister, 'ceramic', 120);
    this.smash.add('mitt', mitt, 'plant', 80);
    // The fridge stands against the wall right behind the Shelf, so a phone sees both whole.
    this.fridge.position.set(STATION_X.fridge, 0, -0.545 + FRIDGE.d / 2);
    k.scene.add(this.fridge);
    this.shelf.position.set(STATION_X.fridge, SHELF.height, -0.1);
    k.scene.add(this.shelf);
    this.book.position.copy(k.at(SLOT.front, 0));
    k.scene.add(this.book);
    this.confetti = new Confetti(k.scene);

    k.pointer.taps.push((x, y) => this.onTap(x, y));
    k.pointer.misses.push((x, y) => this.onMiss(x, y));
    k.pointer.claims.push((h) => this.onClaim(h));
    k.updaters.add((dt, t) => this.update(dt, t));
    k.rail.listeners.add((id) => this.onStation(id));
    k.rail.onLockedRelease = () => this.onLockedSwipe();
    // A swipe that turns to another Station (not a goTo) retires the edge chevrons for good.
    const rail = k.rail;
    k.pointer.swipe = {
      drag: (dx) => rail.drag(dx),
      release: (vx) => { const from = rail.current; rail.release(vx); if (rail.current !== from) this.swiped(); },
    };
    this.rebuildShelf();
  }

  /** Called once the title card is gone. */
  begin() {
    this.hud.show();
    this.idle();
    this.cat.say(`Hi ${PLAYER_NAME}! Tap the book and let's bake!`, 'excited');
    this.cat.wave();
  }

  private swiped() {
    if (this.swipedBefore) return;
    this.swipedBefore = true;
    writeFlag(SWIPED_KEY);
    this.hud.chevrons(false);
  }

  // ---- the secret ---------------------------------------------------------------

  /** What her finger is swinging right now: the thing a Step lets her carry, or the cake on the way to the cat. */
  private swinging(): THREE.Object3D | null {
    if (!this.k.pointer.busy) return null;
    if (this.feed?.held) return this.feed.held.obj;
    if (this.phase !== 'baking' || !this.current || (this.transition && this.transition !== 'arrive')) return null;
    return this.current.weapon ? this.current.weapon() : this.current.focus?.() ?? null;
  }

  /** The cat sees what she did (when it is at that Station), at most every few seconds. */
  private onSmash(name: string, kind: Kind, at: THREE.Vector3) {
    let first = false;
    try { first = !localStorage.getItem(SMASHED_KEY); localStorage.setItem(SMASHED_KEY, '1'); } catch { /* the gasp is just not remembered */ }
    if (Math.abs(this.cat.group.position.x - at.x) > 0.6) return;
    if (!first && this.smashTalkT < SMASH_TALK_GAP) return;
    this.smashTalkT = 0;
    this.cat.say(first ? `${PLAYER_NAME}?! My KITCHEN!!` : pick(SMASH_LINES[kind === 'tile' ? 'tile' : name] ?? SMASH_LINES.tile), 'ooh');
    this.cat.hop();
  }

  // ---- idle ---------------------------------------------------------------------

  idle() {
    this.keepCake();
    this.phase = 'idle';
    this.revealRun++;
    this.flow++;
    this.transition = null;
    this.unfreeze();
    this.unmolding = false;
    this.resetPan();
    this.cat.goTo(STATION_X.counter);
    this.clearCake();
    this.clearLeftovers();
    this.clearPlate();
    this.bowl.clear();
    if (!this.bowl.group.visible) { // back from the reveal
      this.bowl.group.position.copy(this.k.at(SLOT.bowlAway, 0));
      this.bowl.group.visible = true;
      this.k.glide(this.bowl.group, this.bowl.home, 0.6);
    }
    this.pan.visible = false;
    this.pan.getObjectByName('lining')!.visible = false;
    this.pan.getObjectByName('fill')!.visible = false;
    this.pan.getObjectByName('crown')!.visible = false;
    this.book.visible = true;
    this.hud.heading(null);
    this.hud.meter('none');
    this.hud.verdict(null);
    this.hud.buttons([]);
    this.hud.hint('Tap the recipe book to bake. Swipe to look around.');
    this.hud.chevrons(!this.swipedBefore);
    this.k.rail.locked = false;
    this.k.rail.goTo('counter');
  }

  /** A revealed cake goes in the gallery even if she moved on before the cat tasted it (then without a verdict). */
  private keepCake() {
    if (!this.lastEntry || this.lastSaved) return;
    this.lastSaved = true;
    this.gallery.push(this.lastEntry);
    saveGallery(this.gallery);
    this.rebuildShelf();
  }

  /**
   * A swipe while the rail is locked (mid-recipe, or while the cat eats) is a Nudge: the view
   * tugs and comes back, the thing the Step wants touched wiggles, and the hint pops again.
   */
  private onLockedSwipe() {
    let obj: THREE.Object3D = this.eating ? this.cat.group : this.bowl.group;
    if (this.current) {
      const first = Object.keys(this.current.targets?.() ?? {})[0];
      const named = first ? this.current.boxes?.()[first] : undefined;
      obj = named ?? (first === 'pan' ? this.pan : this.bowl.group);
    }
    motion.wiggle(obj);
    sound.play('pop', { gain: 0.25, rate: 1.2 });
    this.hud.nudgeHint(this.steps[this.stepIndex]?.hint ?? '');
  }

  /**
   * A pointer-down no Step claimed, mid-recipe, is a Nudge: the nearest prop of the Step (or
   * the bowl, the pan or the cat) within 90 px gives a wiggle and a pop, and the hint pops
   * to catch the eye. Nothing else happens.
   */
  private onMiss(x: number, y: number) {
    if (this.phase !== 'baking' || !this.current || (this.transition && this.transition !== 'arrive')) return;
    const cands: THREE.Object3D[] = [this.cat.group, this.bowl.group];
    if (this.pan.visible) cands.push(this.pan);
    for (const o of Object.values(this.current.boxes?.() ?? {})) if (o && o.visible && o.parent === this.k.scene && !cands.includes(o)) cands.push(o);
    let best: THREE.Object3D | null = null;
    let bestD = NUDGE_PX, bestC = Infinity;
    for (const o of cands) {
      const s = this.k.boxOf(o)?.screen;
      if (!s) continue;
      // how far the finger is from the thing's box on screen (0 inside it); a tie goes to the nearer middle
      const d = Math.hypot(Math.max(s.x - x, 0, x - s.x - s.w), Math.max(s.y - y, 0, y - s.y - s.h));
      const c = Math.hypot(x - s.x - s.w / 2, y - s.y - s.h / 2);
      if (d < bestD || (d === bestD && c < bestC)) { best = o; bestD = d; bestC = c; }
    }
    if (!best) return;
    this.nudges++;
    if (best === this.cat.group) { void nudge(this.cat.rig); this.cat.flick(); }
    else void nudge(best);
    this.hud.nudgeHint(this.steps[this.stepIndex]?.hint ?? '');
  }

  /** The player grabbed or held something the Step wanted: the cue and the cat's point are done. */
  private onClaim(h: PointerHandler) {
    if (this.phase !== 'baking' || h === this.freeze) return;
    this.cueNow = null;
    this.cat.release();
  }

  /** The Step's cue: what it names, or else its first target. */
  private cueOf(runner: StepRunner | null): Cue | null {
    if (!runner) return null;
    const own = (runner as Cued).cue;
    if (own) return own.call(runner);
    const first = Object.entries(runner.targets?.() ?? {})[0];
    return first ? { name: first[0], at: first[1] } : null;
  }

  /** The cue and the cat's point follow the Step's target each frame (props slide and pop in). */
  private cueFrame(dt: number, t: number) {
    // Idle at the Counter, the finger cue rests on the recipe book: that is where it starts.
    if (this.phase === 'idle') {
      const on = this.book.visible && this.k.rail.current === 'counter' && this.k.rail.settled;
      const p = this.k.toScreen(this.book.position);
      this.hud.cue(on ? p.x : null, p.y);
      return;
    }
    const c = this.phase === 'baking' && (!this.transition || this.transition === 'arrive') ? this.cueOf(this.current) : null;
    if (this.cueNow) {
      this.cueNow.left -= dt;
      if (this.cueNow.left <= 0 || !c) this.cueNow = null;
      else this.cueNow.name = c.name;
    }
    if (this.cueNow && c) {
      const p = this.k.toScreen(c.at);
      if (c.circle) { p.x += Math.cos(t * CUE_CIRCLE.speed) * CUE_CIRCLE.r; p.y += Math.sin(t * CUE_CIRCLE.speed) * CUE_CIRCLE.r * 0.6; }
      this.hud.cue(p.x, p.y);
    } else this.hud.cue(null);
    if (!c) return;
    if (this.cat.isPointing) this.cat.point(c.at);
    else if (c.name !== this.pointed && !this.k.pointer.busy) { this.cat.point(c.at); this.pointed = c.name; }
  }

  /** The finger cue's target right now, or null (for the test driver). */
  get cueName() { return this.cueNow?.name ?? null; }

  private onStation(id: StationId) {
    // After the taste test the header names the cake, and at the Shelf the cat's word for it.
    if (this.phase === 'reveal' && this.lastEntry?.verdict) {
      const e = this.lastEntry;
      if (id === 'fridge') {
        // At the Shelf the cake is one of many: the header names the Shelf, and the verdict and
        // the cat's word stay behind at the Counter with the plate.
        this.hud.heading('Your Shelf', `${this.gallery.length} cake${this.gallery.length === 1 ? '' : 's'}`);
        this.hud.verdict(null);
        this.hud.dismissBubble();
        this.afterButtons(false);
        this.hud.hint('Tap a cake to see it.');
      } else {
        this.hud.heading(cakeName(e), `Cake #${e.n}`); // the verdict pill below says how it went
        this.hud.verdict(VERDICTS[e.verdict!]);
        this.afterButtons(true);
        this.hud.hint('');
      }
      return;
    }
    if (this.phase !== 'idle') return;
    if (id === 'fridge') this.hud.hint(this.gallery.length ? 'Your cakes! Tap one to see it.' : 'The Shelf is empty. Let\'s fix that!');
    else if (id === 'stove') this.hud.hint('The oven. Swipe back to the counter to start.');
    else this.hud.hint('Tap the recipe book to bake. Swipe to look around.');
  }

  private onTap(x: number, y: number) {
    if (this.phase === 'idle' && this.book.visible && this.k.screenDist(x, y, this.book.position) < 90) { this.openBook(); return; }
    if (this.phase === 'baking') return;
    if (this.moreCard && this.k.screenDist(x, y, this.moreSpot()) < 48) {
      const rest = this.gallery.slice(0, -SHELF_MAX);
      this.hud.moreList(rest.map((e) => ({ n: e.n, name: cakeName(e), date: cakeDate(e), verdict: e.verdict ? VERDICTS[e.verdict] : null })));
      sound.play('book', { gain: 0.5 });
      return;
    }
    let best: { obj: THREE.Group; entry: CakeEntry } | null = null;
    let bestD = 48;
    for (const c of this.shelfCakes) {
      const d = this.k.screenDist(x, y, c.obj.position);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      const e = best.entry;
      this.hud.lightbox(`Cake #${e.n} · ${cakeName(e)}`, cakeDate(e), e.verdict ? VERDICTS[e.verdict] : null, this.thumb(e));
      sound.play('chip', { gain: 0.45, rate: 0.9 });
    }
  }

  openBook() {
    sound.play('book', { gain: 0.6 });
    this.cat.release();
    this.hud.book(BASQUE.flavors, (f) => this.startRecipe(f));
  }

  // ---- baking ----------------------------------------------------------------------

  startRecipe(flavor: Flavor) {
    this.keepCake();
    this.smash.rebuildAll();
    this.phase = 'baking';
    this.hud.chevrons(false);
    this.hud.cue(null);
    this.k.rail.locked = true;
    this.flavor = flavor;
    this.steps = BASQUE.steps(flavor);
    this.results.length = 0;
    this.book.visible = false;
    this.stepIndex = -1;
    this.flow++;
    void this.advance(null);
  }

  /**
   * From one Step to the next, in four beats (1.2-2.2 s in all at the Counter):
   *  react   the cat hops and cheers while the finished Step's props hold still a moment;
   *  leave   the Step tidies its props away (runner.leave()), then is disposed;
   *  move    the view goes to the next Station and settles;
   *  arrive  the header pops in, the next Step's props arrive, the cat says its line.
   */
  private async advance(prev: StepRunner | null, result?: Result) {
    const flow = this.flow;
    const live = () => flow === this.flow && this.phase === 'baking';
    this.transitionT = 0;
    if (prev) {
      this.transition = 'react';
      sound.play('chip', { gain: 0.25, rate: 1.4 }); // a tiny tick: that Step is done
      this.cueNow = null;
      this.hud.hint(''); // a finished Step's instruction (or its "a little more!") never outlives it
      this.cat.release();
      this.cat.hop();
      this.k.pointer.handlers.unshift(this.freeze);
      // The bake ends on its own beat (the pan resting on the door, the cat calling the top),
      // so the last Step goes straight on to tidying up.
      if (this.stepIndex < this.steps.length - 1) {
        // say() gives the cat its little bounce: the cheer is a hop on the spot
        if (result === 'under' || result === 'over') this.cat.say(pick(SO_CLOSE), 'meh');
        else this.cat.say(pick(CHEERS), 'ooh');
        await motion.delay(result ? BEAT.reactResult : BEAT.react);
        if (!live()) return;
      }
      this.transition = 'leave';
      await prev.leave?.();
      prev.dispose();
      if (this.current === prev) this.current = null;
      if (!live()) return;
    }
    const i = this.stepIndex + 1;
    if (i >= this.steps.length) {
      this.transition = null;
      this.unfreeze();
      this.stepIndex = i;
      this.reveal();
      return;
    }
    const def = this.steps[i];
    this.transition = 'move';
    const same = this.k.rail.current === def.station;
    this.k.rail.goTo(def.station);
    this.cat.goTo(STATION_X[def.station]);
    await this.until(() => this.k.rail.settled, same ? BEAT.sameStation : BEAT.otherStation);
    if (!live()) return;

    this.transition = 'arrive';
    this.stepIndex = i;
    this.unfreeze();
    this.hud.step(i, this.steps.length, def.title);
    this.hud.hint(def.hint);
    this.hud.meter('none');
    this.hud.buttons([]);
    let finished = false;
    const runner = def.make({
      k: this.k, bowl: this.bowl, hud: this.hud, cat: this.cat, flavor: this.flavor,
      pan: this.pan, oven: this.oven, station: STATION_X[def.station], leftovers: this.leftovers,
      done: (r) => {
        if (finished) return;
        finished = true;
        this.results[i] = r;
        void this.advance(runner, r);
      },
    });
    this.current = runner;
    const arrived = runner.start();
    this.cat.say(def.line, 'excited');
    // The cat points at what the Step wants touched, and a finger cue pulses on it.
    const cue = this.cueOf(runner);
    if (cue) {
      this.cueNow = { name: cue.name, left: CUE_T };
      this.cat.point(cue.at);
      this.pointed = cue.name;
    }
    await Promise.race([Promise.resolve(arrived), motion.delay(BEAT.arrive)]);
    if (live() && this.current === runner && this.transition === 'arrive') this.transition = null;
  }

  /** Resolves once the condition holds, or after `max` game seconds whatever happens. */
  private until(cond: () => boolean, max: number) {
    if (cond()) return Promise.resolve();
    return new Promise<void>((resolve) => { this.waits.push({ until: cond, left: max, resolve }); });
  }

  private unfreeze() {
    const j = this.k.pointer.handlers.indexOf(this.freeze);
    if (j >= 0) this.k.pointer.handlers.splice(j, 1);
  }

  /** Ease the pan along the counter to a world point; resolves when it is there. */
  movePan(to: THREE.Vector3, seconds: number) {
    return this.k.glide(this.pan, to, seconds);
  }

  // ---- reveal and taste test ------------------------------------------------------------

  /**
   * One continuous move from the oven to the counter: the camera rides back, the empty bowl
   * slides off to the left, the cat hops home, and the baked pan rides along to the bowl's
   * slot. There the springform opens and the cake underneath is the one that baked.
   */
  private reveal() {
    this.phase = 'reveal';
    this.k.rail.locked = true; // until the cake is out; the view is on its way already
    const keyIndex = this.steps.findIndex((s) => s.key);
    const quality: Result = this.results[keyIndex] ?? 'right';
    // The cake joins the gallery (and the Shelf) once the cat has had its verdict.
    const entry: CakeEntry = { n: this.gallery.length + 1, recipe: BASQUE.id, flavor: this.flavor.id, quality, date: new Date().toISOString() };
    this.lastEntry = entry;
    this.lastSaved = false;
    this.clearLeftovers();
    this.clearPlate();

    this.k.rail.goTo('counter');
    this.cat.goTo(STATION_X.counter);
    this.k.glide(this.bowl.group, this.k.at(SLOT.bowlAway, 0), 0.5).then(() => {
      if (this.phase === 'reveal') this.bowl.group.visible = false;
    });
    this.hud.hint('');
    this.hud.buttons([]);
    this.hud.verdict(null);
    this.hud.meter('none');

    const run = ++this.revealRun;
    const pan = this.pan;
    pan.visible = true;
    const from = pan.position.clone();
    const to = this.k.at(SLOT.bowl, 0);
    motion.tween(REVEAL.ride, easeInOutCubic, (e) => {
      if (run !== this.revealRun) return;
      pan.position.lerpVectors(from, to, e);
      pan.position.y += Math.sin(e * Math.PI) * REVEAL.rideArc;
      pan.rotation.z = Math.sin(e * Math.PI) * 0.08; // leans into the ride
    }).then(() => {
      if (run !== this.revealRun) return;
      pan.rotation.set(0, 0, 0);
      motion.squash(pan, 0.08, 0.22);
      sound.play('clink', { gain: 0.5, rate: 0.8 });
      this.unmold(run, quality, entry);
    });
  }

  /** The latch flips, the ring lifts and fades, and the cake takes the pan's place in the same frame. */
  private unmold(run: number, quality: Result, entry: CakeEntry) {
    const pan = this.pan;
    const ring = pan.getObjectByName('ring') as THREE.Mesh;
    const ringMat = ring.material as THREE.MeshStandardMaterial;
    const clip = this.panClip();
    const ringY = ring.position.y, clipY = clip.position.y;
    this.unmolding = true;
    sound.play('tap', { gain: 0.5, rate: 1.3 });
    motion.tween(REVEAL.latch, easeOutCubic, (k) => { if (run === this.revealRun) clip.rotation.z = -1.1 * k; })
      .then(() => {
        if (run !== this.revealRun) return;
        ringMat.transparent = true;
        ringMat.depthWrite = false;
        return motion.tween(REVEAL.lift, easeOutCubic, (k) => {
          if (run !== this.revealRun) return;
          ring.position.y = ringY + REVEAL.ringRise * k;
          clip.position.y = clipY + REVEAL.ringRise * k;
          ringMat.opacity = 1 - k;
          clip.visible = k < 0.5;
        });
      })
      .then(() => {
        if (run !== this.revealRun) return;
        this.unmolding = false;
        // The cake that comes out is the one that was in the oven: same top colour as the pan's.
        const baked = (pan.getObjectByName('fill') as THREE.Mesh).material as THREE.MeshStandardMaterial;
        const cake = makeCake(this.flavor.id, quality, baked.color);
        cake.position.set(pan.position.x, 0, pan.position.z);
        this.k.scene.add(cake);
        this.cake = cake;
        pan.visible = false;
        this.resetPan();
        this.served(cake, quality, entry);
      });
  }

  /**
   * The cake is out: confetti, its name in the header, and only the taste test to do. The
   * buttons wait for the verdict, so the one thing to do is feed the cat.
   */
  private served(cake: THREE.Group, quality: Result, _entry: CakeEntry) {
    this.k.rail.locked = false;
    this.confetti.burst(cake.position.clone().add(new THREE.Vector3(0, 0.12, 0)));
    this.feed = new Carry(this.k, [{ obj: cake, home: cake.position.clone(), placed: false }], {
      holdY: 0.1,
      grabPx: 110,
      mass: 0.6,
      receiver: () => null, // the chomp is its squash
      onGrab: () => { this.untouchedT = 0; this.cat.release(); },
      onDrop: (_item, pos) => {
        if (pos.distanceTo(this.cat.mouth()) > 0.11) return false;
        this.eat();
        return true;
      },
    });
    this.k.pointer.handlers.unshift(this.feed);
    this.hud.heading(displayName(BASQUE, this.flavor.id));
    this.cat.cheer();
    this.hud.hint('Drag the cake to the cat');
    this.hud.buttons([]);
    this.untouchedT = 0;
    this.urged = false;
    this.cat.say(`Ta-da! ${BASQUE.lines[quality]} You made it, ${PLAYER_NAME}!`, quality === 'right' ? 'love' : 'excited');
  }

  /** The springform's latch: the one box on the pan. */
  private panClip() {
    return this.pan.children.find((c) => (c as THREE.Mesh).geometry instanceof THREE.BoxGeometry) as THREE.Mesh;
  }

  /** Put the springform back together (ring down and opaque, latch shut) for the next bake. */
  private resetPan() {
    const ring = this.pan.getObjectByName('ring') as THREE.Mesh;
    const m = ring.material as THREE.MeshStandardMaterial;
    ring.position.y = 0.0275;
    m.opacity = 1;
    m.transparent = false;
    m.depthWrite = true;
    const clip = this.panClip();
    clip.position.y = 0.03;
    clip.rotation.set(0, 0, 0);
    clip.visible = true;
    this.pan.rotation.set(0, 0, 0);
  }

  private eat() {
    if (!this.cake || !this.feed) return;
    this.k.pointer.handlers.splice(this.k.pointer.handlers.indexOf(this.feed), 1);
    this.feed = null;
    this.eating = true;
    this.k.rail.locked = true; // the cat eats where it sits; the view stays with it
    this.eatT = 0;
    this.chomping = false;
    this.biteTo = this.cakeS = 1;
    this.biteT = 99;
    this.gulped = false;
    this.eatFrom.copy(this.cake.position);
    // The cake is held out in front of the cat, toward where it came from (the bowl's slot,
    // the middle of the view) and a little toward the camera, so the cat turns to bite it.
    const seat = this.cat.group.position, cam = this.k.camera.position, slot = this.k.at(SLOT.bowl, 0);
    this.biteDir.set(slot.x - seat.x + (cam.x - seat.x) * 0.3, 0, slot.z - seat.z + (cam.z - seat.z) * 0.3).normalize();
    // The bitten wedge (the cake's +z) faces back toward the cat, turned a little to the
    // camera's side so the custard inside shows once the first bite is taken.
    const d = this.biteDir;
    const side = new THREE.Vector3(d.z, 0, -d.x);
    if (side.dot(new THREE.Vector3(cam.x - seat.x, 0, cam.z - seat.z)) < 0) side.negate();
    const face = side.multiplyScalar(0.8).addScaledVector(d, -0.6);
    this.cake.rotation.set(0, Math.atan2(face.x, face.z), 0);
    this.hud.hint('');
    this.cat.say('nom nom nom…', 'yum');
  }

  /**
   * Where the cake sits against the cat's mouth at scale s: its near edge at the lips and its
   * top just under them, so the jaws close on the cake rather than swallowing it whole.
   */
  private biteSpot(s: number, out: THREE.Vector3) {
    const m = this.cat.mouth();
    const d = this.biteDir;
    // tuned by eye: the cake's middle 6.5 cm out from the lips (its near edge at them), its top a little under them
    return out.set(m.x + d.x * 0.065 * s, m.y - 0.035 * s, m.z + d.z * 0.065 * s);
  }

  /** The taste test: the cake comes up to the mouth, then goes in three bites and a gulp. */
  private eatFrame(dt: number) {
    const cake = this.cake!;
    this.eatT += dt;
    const t = this.eatT;
    const spot = this.biteSpot(this.cakeS, new THREE.Vector3());
    if (t < EAT.arrive) cake.position.lerpVectors(this.eatFrom, spot, ease(t / EAT.arrive));
    else cake.position.copy(spot);
    if (t >= EAT.arrive && !this.chomping) {
      this.chomping = true;
      this.cat.chomp(this.cat.group.position.clone().addScaledVector(this.biteDir, 0.3), (i) => {
        this.biteTo = BITES[i];
        this.biteT = 0;
        // the first bite takes a wedge out of the cake and shows the custard inside
        if (i === 0) {
          const wedge = cake.getObjectByName('wedge'), cut = cake.getObjectByName('cut');
          if (wedge) wedge.visible = false;
          if (cut) cut.visible = true;
        }
        // the jaws coming down: the recorded bites take turns, each a touch higher than the last
        sound.play('chomp', { gain: 0.7, rate: 0.95 + i * 0.07 + Math.random() * 0.05 });
      });
    }
    // Each bite takes its third quickly, with a little squash as the jaws close on it.
    this.biteT += dt;
    const from = this.biteTo === BITES[0] ? 1 : this.biteTo + 0.33;
    this.cakeS = this.biteT < EAT.bite ? from + (this.biteTo - from) * easeOutCubic(this.biteT / EAT.bite) : this.biteTo;
    if (!this.gulped && this.cakeS <= GULP_AT) { this.gulped = true; this.cat.gulp(); sound.play('gulp', { gain: 0.6 }); }
    const squash = this.biteT < 0.12 ? Math.sin((this.biteT / 0.12) * Math.PI) * 0.2 : 0;
    const s = Math.max(0.001, this.cakeS);
    cake.visible = this.cakeS > 0.02;
    cake.scale.set(s * (1 + squash * 0.5), s * (1 - squash), s * (1 + squash * 0.5));
    if (t >= EAT.arrive + CHOMP.end) this.finishEating();
  }

  /** How much of the cake is left (its scale), for the test driver. */
  get cakeScale() { return this.cake ? this.cakeS : null; }

  private finishEating() {
    this.eating = false;
    this.k.rail.locked = false;
    this.clearCake();
    const q = this.lastEntry?.quality ?? 'right';
    const v = VERDICTS[q];
    if (this.lastEntry) {
      this.lastEntry.verdict = q;
      this.keepCake();
      this.hud.heading(cakeName(this.lastEntry), `Cake #${this.lastEntry.n}`);
    }
    this.hud.verdict(v);
    this.putPlate(v);
    this.afterButtons(this.k.rail.current !== 'fridge');
    // The verdict's sting: bussin gets the bells and a pop, mid a level shrug of a knock, ass a falling tock.
    if (q === 'right') { sound.play('cheer', { rate: 1.2 }); sound.play('pop', { gain: 0.4, delay: 0.05 }); }
    else if (q === 'under') sound.play('meh', { gain: 0.5 });
    else sound.play('over', { gain: 0.5, rate: 0.8 });
    if (q === 'right') this.cat.cheer();
    this.cat.say(v.line, v.expr);
    this.hud.hint('');
  }

  /** The empty plate lands where the cake stood, crumbs and fork on it, and the stamp pops up. */
  private putPlate(v: { label: string; color: string }) {
    this.clearPlate();
    const plate = makePlate(this.lastEntry?.flavor ?? 'classic', v.label, v.color);
    plate.position.copy(this.k.at(SLOT.bowl, 0));
    this.k.scene.add(plate);
    this.plate = plate;
    motion.squash(plate, 0.1, 0.25);
    const stamp = plate.getObjectByName('stamp')!;
    const s0 = stamp.scale.x;
    stamp.scale.setScalar(0.001);
    motion.delay(0.25)
      .then(() => { if (this.plate === plate) sound.play('chip', { gain: 0.35, rate: 1.2 }); return motion.tween(0.35, easeOutBack, (e) => stamp.scale.setScalar(Math.max(0.001, s0 * e))); });
  }

  private clearPlate() {
    if (!this.plate) return;
    this.k.scene.remove(this.plate);
    this.plate = null;
  }

  /**
   * A picture of a Shelf cake for the lightbox: the cake model drawn alone on cream, once,
   * into a corner of the main canvas and copied out straight away (then the frame is redrawn).
   */
  private thumb(e: CakeEntry): string | null {
    const hit = this.thumbs.get(e.n);
    if (hit) return hit;
    try {
      const r = this.k.renderer;
      const S = 256;
      const dpr = r.getPixelRatio();
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xfff6e9);
      scene.add(new THREE.HemisphereLight(0xfff8ee, 0xf2cfc4, 1.3));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(0.3, 1, 0.6);
      scene.add(sun);
      const cake = e.recipe === 'basque' ? makeCake(e.flavor ?? 'classic', e.quality) : makeOtherCake(e.recipe);
      scene.add(cake);
      const cam = new THREE.PerspectiveCamera(32, 1, 0.01, 5);
      cam.position.set(0, 0.22, 0.34);
      cam.lookAt(0, 0.035, 0);
      const w = Math.round(S / dpr);
      r.setScissorTest(true);
      r.setViewport(0, 0, w, w);
      r.setScissor(0, 0, w, w);
      r.render(scene, cam);
      const out = document.createElement('canvas');
      out.width = out.height = S;
      const H = r.domElement.height;
      out.getContext('2d')!.drawImage(r.domElement, 0, H - w * dpr, w * dpr, w * dpr, 0, 0, S, S);
      r.setScissorTest(false);
      const size = r.getSize(new THREE.Vector2());
      r.setViewport(0, 0, size.x, size.y);
      r.render(this.k.scene, this.k.camera);
      cake.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
      const url = out.toDataURL('image/png');
      this.thumbs.set(e.n, url);
      return url;
    } catch {
      return null;
    }
  }

  /** Back to the book; the cat asks for another and paws at it. */
  /** The buttons once the cat has tasted: bake again, and a way to the Shelf unless already there. */
  private afterButtons(withShelf: boolean) {
    this.hud.buttons([
      { label: 'Bake another', onClick: () => this.bakeAnother() },
      ...(withShelf ? [{ label: 'Shelf', ghost: true, onClick: () => this.k.rail.goTo('fridge') }] : []),
    ]);
  }

  private bakeAnother() {
    this.idle();
    this.cat.say('Another one?', 'excited');
    this.cat.point(this.book.position);
  }

  /** While the revealed cake sits untouched, the cat reaches for it after a while and asks. */
  private tasteUrge(dt: number) {
    if (this.phase !== 'reveal' || !this.feed || !this.cake || this.eating) return;
    if (this.feed.held) { this.untouchedT = 0; return; }
    this.untouchedT += dt;
    if (this.urged || this.untouchedT < TASTE_URGE_T) return;
    this.urged = true;
    this.cat.point(this.cake.position);
    this.cat.say('Let me try it!', 'excited');
  }

  // ---- per frame --------------------------------------------------------------------

  private update(dt: number, t: number) {
    this.smashTalkT += dt;
    this.current?.update(dt, t);
    this.confetti.update(dt);
    this.feed?.update(dt, t);
    this.transitionT += dt;
    this.cueFrame(dt, t);
    this.makeRoom();
    this.tasteUrge(dt);
    if (this.waits.length) {
      this.waits = this.waits.filter((w) => {
        w.left -= dt;
        if (w.left > 0 && !w.until()) return true;
        w.resolve();
        return false;
      });
    }
    if (this.book.visible) this.book.position.y = Math.sin(t * 2) * 0.002 + 0.002;
    if (this.eating && this.cake) this.eatFrame(dt);
  }

  /**
   * Keep the cat's bubble clear of the prop the finger is handling: it finds a spot beside the
   * head that does not cover it, or docks. (The cat's seat, SLOT.cat, keeps its face clear.)
   */
  private makeRoom() {
    const obj = this.focusObj();
    this.hud.avoid = obj && obj.visible ? this.screenRect(obj) : null;
  }

  /** The prop the finger is handling: the current Step's, or the revealed cake until the cat eats it. */
  private focusObj(): THREE.Object3D | null {
    if (this.current) return this.current.focus?.() ?? null;
    return this.phase === 'reveal' && this.cake && !this.eating ? this.cake : null;
  }

  /** For the test driver: the focus prop's tight screen rect and the middle of the cat's face. */
  roomInfo() {
    const obj = this.focusObj();
    const b = obj && obj.visible ? this.k.boxOf(obj) : null;
    return { focus: b ? b.screen : null, face: this.k.toScreen(this.cat.faceCentre()), bubbleVisible: this.hud.bubbleVisible };
  }

  /** Screen rect (CSS px) of an object's world box: cheap (8 corners), a little generous. */
  private screenRect(obj: THREE.Object3D) {
    const box = this.roomBox.setFromObject(obj);
    if (box.isEmpty()) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const p = this.k.toScreen(this.roomV.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---- shelf --------------------------------------------------------------------------

  private rebuildShelf() {
    for (const c of this.shelfCakes) this.k.scene.remove(c.obj);
    this.shelfCakes = [];
    if (this.moreCard) {
      this.k.scene.remove(this.moreCard);
      const m = this.moreCard.material as THREE.MeshStandardMaterial;
      m.map?.dispose();
      m.dispose();
      this.moreCard.geometry.dispose();
      this.moreCard = null;
    }
    // Newest first: the front row holds the latest six, the riser behind it the six before.
    const entries = this.gallery.slice(-SHELF_MAX).reverse();
    const plankTop = this.shelf.position.y + 0.008;
    const extra = this.gallery.length - SHELF_MAX;
    if (extra > 0) {
      const card = makeMoreCard(extra);
      card.position.set(this.shelf.position.x, plankTop + MORE_CARD.peek, this.shelf.position.z + SHELF.depth / 2 + 0.002);
      card.rotation.z = MORE_CARD.tilt;
      this.k.scene.add(card);
      this.moreCard = card;
    }
    entries.forEach((entry, i) => {
      const obj = entry.recipe === 'basque' ? makeCake(entry.flavor ?? 'classic', entry.quality) : makeOtherCake(entry.recipe);
      obj.scale.setScalar(SHELF.cakeScale);
      const row = Math.floor(i / SHELF.perRow);
      const col = i % SHELF.perRow;
      const inRow = Math.min(SHELF.perRow, entries.length - row * SHELF.perRow);
      obj.position.set(
        this.shelf.position.x + (col - (inRow - 1) / 2) * SHELF.spacing,
        plankTop + (row === 0 ? 0 : SHELF.riser),
        this.shelf.position.z + (row === 0 ? SHELF.frontZ : SHELF.backZ),
      );
      // The verdict card leans on the cake's front, its foot on the Shelf.
      const v = entry.verdict ? VERDICTS[entry.verdict] : null;
      const tag = makeVerdictTag(v ? v.label : 'new', v ? v.color : '#fff6e9', SHELF.cakeScale);
      const r = (entry.recipe === 'basque' ? 0.074 : 0.065) * SHELF.cakeScale; // the collar's or the plain cake's radius, in world units
      tag.rotation.x = -0.35;
      tag.position.set(0, 0.0055 / SHELF.cakeScale, (r + 0.0025) / SHELF.cakeScale);
      obj.add(tag);
      this.k.scene.add(obj);
      this.shelfCakes.push({ obj, entry });
    });
  }

  // ---- housekeeping ----------------------------------------------------------------------

  private clearCake() {
    if (this.feed) { this.k.pointer.handlers.splice(this.k.pointer.handlers.indexOf(this.feed), 1); this.feed = null; }
    if (this.cake) { this.k.scene.remove(this.cake); this.cake = null; }
    this.eating = false;
  }

  private clearLeftovers() {
    for (const l of this.leftovers) {
      this.k.scene.remove(l.mesh);
      if (l.body) this.k.world.removeRigidBody(l.body);
    }
    this.leftovers.length = 0;
  }

  /** Things a test driver can aim at right now (only what is at the current Station). */
  targets(): Record<string, THREE.Vector3> {
    const out: Record<string, THREE.Vector3> = this.current?.targets?.() ?? {};
    const station = this.k.rail.current;
    if (this.book.visible) out.book = this.book.position.clone();
    if (station === 'counter') {
      out.cat = this.cat.mouth();
      // The paws (where Cat builds them) must stay in frame: the driver checks their pixels.
      for (const [name, s] of [['pawL', -1], ['pawR', 1]] as const) out[name] = this.cat.paw(s);
    }
    if (this.cake) out.cake = this.cake.position.clone();
    // From the end of the bake to the cake coming out the pan is on its own (no Step owns it).
    const last = this.phase === 'reveal' || (this.phase === 'baking' && !this.current && this.stepIndex === this.steps.length - 1);
    if (last && this.pan.visible && !out.pan) out.pan = this.pan.position.clone();
    if (this.unmolding) out.ring = (this.pan.getObjectByName('ring') as THREE.Mesh).getWorldPosition(new THREE.Vector3());
    if (station === 'fridge') this.shelfCakes.forEach((c, i) => { out[`shelf${i}`] = c.obj.position.clone(); });
    if (station === 'fridge' && this.moreCard) out.more = this.moreSpot();
    return out;
  }

  /** Every visible named prop in the Kitchen, for the test driver's overlap checks. */
  boxes(): Record<string, THREE.Object3D> {
    const out: Record<string, THREE.Object3D> = {
      bowl: this.bowl.group, cat: this.cat.group, pan: this.pan, book: this.book, oven: this.oven,
      ovenDoor: this.oven.getObjectByName('door')!, fridge: this.fridge, shelf: this.shelf,
      ...(this.current?.boxes?.() ?? {}),
    };
    if (this.cake) out.cake = this.cake;
    this.shelfCakes.forEach((c, i) => { out[`shelf${i}`] = c.obj; });
    if (this.moreCard) out.more = this.moreCard;
    for (const [name, obj] of Object.entries(out)) if (!obj || !obj.visible) delete out[name];
    return out;
  }

  /** The middle of the "and N more" card, where a tap opens the list. */
  private moreSpot() {
    return this.moreCard!.localToWorld(new THREE.Vector3(0, -MORE_CARD.size[1] / 2, 0));
  }

  /** Are the swipe chevrons showing (for the test driver). */
  get chevronsShown() { return this.hud.chevronsVisible; }

  /** How far into the chomp the cat is (seconds), for the test driver. */
  get eatProgress() { return this.eating ? this.eatT : 0; }
}

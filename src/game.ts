// The flow: idle in the Kitchen with the recipe book, run a recipe Step by Step, reveal
// the cake, feed it to the cat, put it on the Shelf.
import * as THREE from 'three';
import { Kitchen, SLOT } from './kitchen';
import { STATION_X, type StationId } from './camera';
import { Bowl } from './bowl';
import { Cat } from './cat';
import { Hud } from './hud';
import { Carry } from './gestures';
import { Confetti } from './confetti';
import { makePan, makeOven, makeFridge, makeShelf, makeBook, makeCake, makeOtherCake, makeVerdictTag, SHELF } from './props';
import { motion } from './motion';
import { BASQUE, VERDICTS, CHEERS, displayName, type Flavor, type StepDef } from './recipes';
import { loadGallery, saveGallery, type CakeEntry } from './gallery';
import { sound } from './sound';
import { ease, type StepRunner, type Result, type Leftover } from './steps/step';

export const PLAYER_NAME = 'Creme';

type Phase = 'idle' | 'baking' | 'reveal';

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

/** Taste-test timing (seconds): the cake reaches the mouth, then three bites a quarter second apart. */
const EAT = { arrive: 0.3, firstBite: 0.1, bite: 0.25 };

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
  private readonly shelf = makeShelf();
  private readonly fridge = makeFridge();
  cake: THREE.Group | null = null;
  private feed: Carry | null = null;
  private lastEntry: CakeEntry | null = null;
  private eating = false;
  private eatT = 0;
  private eatFrom = new THREE.Vector3();
  private chomps = 0;
  private nextTimer = 0;

  constructor(readonly k: Kitchen, readonly hud: Hud) {
    this.bowl = new Bowl(k, SLOT.bowl.clone());
    this.cat = new Cat(k, hud, SLOT.cat.clone());
    this.pan.visible = false;
    k.scene.add(this.pan);
    this.oven.position.set(STATION_X.stove, 0, -0.2);
    k.scene.add(this.oven);
    // The fridge stands at the far left of the Fridge Station, the Shelf in the middle; a
    // phone sees the Shelf and a swipe past the end shows the fridge beside it.
    this.fridge.position.set(STATION_X.fridge - 0.5, 0, -0.35);
    this.fridge.rotation.y = 0.22; // angled toward the Shelf so its door, handles and magnets show (tuned by eye: its front corner clears the plank by 2 cm)
    k.scene.add(this.fridge);
    this.shelf.position.set(STATION_X.fridge, SHELF.height, -0.1);
    k.scene.add(this.shelf);
    this.book.position.copy(k.at(SLOT.front, 0));
    k.scene.add(this.book);
    this.confetti = new Confetti(k.scene);

    k.pointer.taps.push((x, y) => this.onTap(x, y));
    k.updaters.add((dt, t) => this.update(dt, t));
    k.rail.listeners.add((id) => this.onStation(id));
    k.rail.onLockedRelease = () => this.onLockedSwipe();
    this.rebuildShelf();
  }

  /** Called once the title card is gone. */
  begin() {
    this.hud.show();
    this.idle();
    this.cat.say(`Hi ${PLAYER_NAME}! Tap the book and let's bake!`, 'excited');
  }

  // ---- idle ---------------------------------------------------------------------

  idle() {
    this.phase = 'idle';
    this.clearCake();
    this.clearLeftovers();
    this.bowl.clear();
    if (!this.bowl.group.visible) { // back from the reveal
      this.bowl.group.position.copy(this.k.at(SLOT.bowlAway, 0));
      this.bowl.group.visible = true;
      this.k.glide(this.bowl.group, this.bowl.home, 0.6);
    }
    this.pan.visible = false;
    this.pan.getObjectByName('lining')!.visible = false;
    this.pan.getObjectByName('fill')!.visible = false;
    this.book.visible = true;
    this.hud.heading(null);
    this.hud.meter('none');
    this.hud.verdict(null);
    this.hud.buttons([]);
    this.hud.hint('Tap the recipe book to bake. Swipe to look around.');
    this.k.rail.locked = false;
    this.k.rail.goTo('counter');
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
    this.hud.nudgeHint(this.steps[this.stepIndex]?.hint ?? '');
  }

  private onStation(id: StationId) {
    if (this.phase !== 'idle') return;
    if (id === 'fridge') this.hud.hint(this.gallery.length ? 'Your cakes! Tap one to see it.' : 'The Shelf is empty. Let\'s fix that!');
    else if (id === 'stove') this.hud.hint('The oven. Swipe back to the counter to start.');
    else this.hud.hint('Tap the recipe book to bake. Swipe to look around.');
  }

  private onTap(x: number, y: number) {
    if (this.phase === 'idle' && this.book.visible && this.k.screenDist(x, y, this.book.position) < 90) { this.openBook(); return; }
    if (this.phase === 'baking') return;
    let best: { obj: THREE.Group; entry: CakeEntry } | null = null;
    let bestD = 48;
    for (const c of this.shelfCakes) {
      const d = this.k.screenDist(x, y, c.obj.position);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      const e = best.entry;
      const name = e.recipe === 'basque' ? displayName(BASQUE, e.flavor) : e.recipe === 'tiramisu' ? 'Tiramisu' : 'Cream Puff';
      const date = new Date(e.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      this.hud.lightbox(`Cake #${e.n} · ${name}`, date, e.verdict ? VERDICTS[e.verdict] : null);
      sound.play('pop', { gain: 0.5 });
    }
  }

  openBook() {
    sound.play('paper', { gain: 0.6 });
    this.hud.book(BASQUE.flavors, (f) => this.startRecipe(f));
  }

  // ---- baking ----------------------------------------------------------------------

  startRecipe(flavor: Flavor) {
    this.phase = 'baking';
    this.k.rail.locked = true;
    this.flavor = flavor;
    this.steps = BASQUE.steps(flavor);
    this.results.length = 0;
    this.book.visible = false;
    this.stepIndex = -1;
    this.nextStep();
  }

  private nextStep() {
    this.stepIndex++;
    if (this.stepIndex >= this.steps.length) { this.reveal(); return; }
    const def = this.steps[this.stepIndex];
    const i = this.stepIndex;
    this.k.rail.goTo(def.station);
    this.hud.step(i, this.steps.length, def.title);
    this.hud.hint(def.hint);
    this.hud.meter('none');
    this.hud.buttons([]);
    this.cat.say(def.line, 'excited');
    let finished = false;
    const runner = def.make({
      k: this.k, bowl: this.bowl, hud: this.hud, cat: this.cat, flavor: this.flavor,
      pan: this.pan, oven: this.oven, station: STATION_X[def.station], leftovers: this.leftovers,
      done: (result) => {
        if (finished) return;
        finished = true;
        this.results[i] = result;
        this.cat.say(pick(CHEERS), 'ooh');
        // The Step tidies its props away (the pan slides off, the jug leaves) while the cat
        // cheers; only then is it disposed and the next Step queued.
        Promise.resolve(runner.leave?.()).then(() => {
          runner.dispose();
          this.current = null;
          this.nextTimer = 0.9;
        });
      },
    });
    this.current = runner;
    runner.start();
  }

  /** Ease the pan along the counter to a world point; resolves when it is there. */
  movePan(to: THREE.Vector3, seconds: number) {
    return this.k.glide(this.pan, to, seconds);
  }

  // ---- reveal and taste test ------------------------------------------------------------

  private reveal() {
    this.phase = 'reveal';
    this.k.rail.locked = false;
    const keyIndex = this.steps.findIndex((s) => s.key);
    const quality: Result = this.results[keyIndex] ?? 'right';
    const entry: CakeEntry = { n: this.gallery.length + 1, recipe: BASQUE.id, flavor: this.flavor.id, quality, date: new Date().toISOString() };
    this.gallery.push(entry);
    saveGallery(this.gallery);
    this.lastEntry = entry;
    this.rebuildShelf();
    this.clearLeftovers();

    this.k.rail.goTo('counter');
    // The pan stays at the Stove until the cake exists, then slides off out of view.
    this.movePan(this.k.at(SLOT.park, STATION_X.stove), 0.5).then(() => { this.pan.visible = false; });
    // The empty bowl slides off to the left and hides (idle() brings it back); the cake pops
    // into its slot, beside the cat, once the bowl is out of the way.
    const cake = makeCake(this.flavor.id, quality);
    cake.position.copy(this.k.at(SLOT.bowl, 0));
    cake.visible = false;
    this.k.scene.add(cake);
    this.cake = cake;
    this.k.glide(this.bowl.group, this.k.at(SLOT.bowlAway, 0), 0.5).then(() => {
      if (this.phase !== 'reveal' || this.cake !== cake) return;
      this.bowl.group.visible = false;
      motion.popIn(cake);
      this.confetti.burst(cake.position.clone().add(new THREE.Vector3(0, 0.12, 0)));
      sound.play('confetti');
      this.feed = new Carry(this.k, [{ obj: cake, home: cake.position.clone(), placed: false }], {
        holdY: 0.1,
        grabPx: 110,
        onDrop: (_item, pos) => {
          if (pos.distanceTo(this.cat.mouth()) > 0.11) return false;
          this.eat();
          return true;
        },
      });
      this.k.pointer.handlers.unshift(this.feed);
    });

    this.hud.heading(displayName(BASQUE, this.flavor.id), `Cake #${entry.n}`);
    this.hud.hint('Drag the cake to the cat for a taste test!');
    this.hud.verdict(null);
    this.hud.buttons([
      { label: 'Bake another', onClick: () => this.idle() },
      { label: 'Shelf', ghost: true, onClick: () => this.k.rail.goTo('fridge') },
    ]);
    this.cat.say(`${BASQUE.lines[quality]} You made it, ${PLAYER_NAME}!`, quality === 'right' ? 'love' : 'excited');
  }

  private eat() {
    if (!this.cake || !this.feed) return;
    this.k.pointer.handlers.splice(this.k.pointer.handlers.indexOf(this.feed), 1);
    this.feed = null;
    this.eating = true;
    this.k.rail.locked = true; // the cat eats where it sits; the view stays with it
    this.eatT = 0;
    this.chomps = 0;
    this.eatFrom.copy(this.cake.position);
    this.hud.hint('');
    this.cat.say('nom nom nom…', 'yum');
  }

  /** The taste test: the cake goes to the mouth, then disappears in three bites. */
  private eatFrame(dt: number) {
    const cake = this.cake!;
    this.eatT += dt;
    const t = this.eatT;
    if (t < EAT.arrive) cake.position.lerpVectors(this.eatFrom, this.cat.mouth(), ease(t / EAT.arrive));
    else cake.position.copy(this.cat.mouth());
    if (t >= EAT.arrive && this.chomps === 0) this.cat.chomp();
    const bite = EAT.arrive + EAT.firstBite + this.chomps * EAT.bite;
    if (this.chomps < 3 && t >= bite) { this.chomps++; sound.play('chomp'); }
    // A third of the cake goes with each bite, with a little squash as the jaws close.
    const since = t - (EAT.arrive + EAT.firstBite + (this.chomps - 1) * EAT.bite);
    const squash = this.chomps > 0 && since < 0.12 ? Math.sin((since / 0.12) * Math.PI) * 0.25 : 0;
    const s = Math.max(0.001, 1 - this.chomps / 3);
    cake.scale.set(s * (1 + squash * 0.5), s * (1 - squash), s * (1 + squash * 0.5));
    if (t >= EAT.arrive + EAT.firstBite + 2 * EAT.bite + 0.25) this.finishEating();
  }

  private finishEating() {
    this.eating = false;
    this.k.rail.locked = false;
    this.clearCake();
    const q = this.lastEntry?.quality ?? 'right';
    if (this.lastEntry) { this.lastEntry.verdict = q; saveGallery(this.gallery); }
    const v = VERDICTS[q];
    this.hud.verdict(v);
    this.cat.say(v.line, v.expr);
    this.hud.hint('');
  }

  // ---- per frame --------------------------------------------------------------------

  private update(dt: number, t: number) {
    this.current?.update(dt, t);
    this.confetti.update(dt);
    this.feed?.update(dt, t);
    if (this.nextTimer > 0) {
      this.nextTimer -= dt;
      if (this.nextTimer <= 0) this.nextStep();
    }
    if (this.book.visible) this.book.position.y = Math.sin(t * 2) * 0.002 + 0.002;
    if (this.eating && this.cake) this.eatFrame(dt);
  }

  // ---- shelf --------------------------------------------------------------------------

  private rebuildShelf() {
    for (const c of this.shelfCakes) this.k.scene.remove(c.obj);
    this.shelfCakes = [];
    // Newest first: the front row holds the latest six, the riser behind it the six before.
    const entries = this.gallery.slice(-SHELF.perRow * 2).reverse();
    const plankTop = this.shelf.position.y + 0.008;
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
      for (const [name, s] of [['pawL', -1], ['pawR', 1]] as const) out[name] = this.cat.group.localToWorld(new THREE.Vector3(s * 0.035, 0.016, 0.04));
    }
    if (this.cake) out.cake = this.cake.position.clone();
    if (station === 'fridge') this.shelfCakes.forEach((c, i) => { out[`shelf${i}`] = c.obj.position.clone(); });
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
    for (const [name, obj] of Object.entries(out)) if (!obj || !obj.visible) delete out[name];
    return out;
  }

  /** How far into the chomp the cat is (seconds), for the test driver. */
  get eatProgress() { return this.eating ? this.eatT : 0; }
}

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
import { makePan, makeOven, makeFridge, makeShelf, makeBook, makeCake, makeOtherCake } from './props';
import { BASQUE, VERDICTS, CHEERS, displayName, type Flavor, type StepDef } from './recipes';
import { loadGallery, saveGallery, type CakeEntry } from './gallery';
import { sound } from './sound';
import { ease, type StepRunner, type Result, type Leftover } from './steps/step';

export const PLAYER_NAME = 'Creme';

type Phase = 'idle' | 'baking' | 'reveal';

const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

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
    const fridge = makeFridge();
    fridge.position.set(STATION_X.fridge - 0.34, 0, -0.36);
    k.scene.add(fridge);
    this.shelf.position.set(STATION_X.fridge, 0.1, -0.13);
    k.scene.add(this.shelf);
    this.book.position.copy(k.at(SLOT.front, 0));
    k.scene.add(this.book);
    this.confetti = new Confetti(k.scene);

    k.pointer.taps.push((x, y) => this.onTap(x, y));
    k.updaters.add((dt, t) => this.update(dt, t));
    k.rail.listeners.add((id) => this.onStation(id));
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
    this.pan.visible = false;
    this.pan.getObjectByName('lining')!.visible = false;
    this.pan.getObjectByName('fill')!.visible = false;
    this.book.visible = true;
    this.hud.heading(null);
    this.hud.meter('none');
    this.hud.tag(null);
    this.hud.verdict(null);
    this.hud.buttons([]);
    this.hud.hint('Tap the recipe book to bake. Swipe to look around.');
    this.k.rail.goTo('counter');
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
        runner.dispose();
        this.current = null;
        this.cat.say(pick(CHEERS), 'ooh');
        this.nextTimer = 0.9;
      },
    });
    this.current = runner;
    runner.start();
  }

  // ---- reveal and taste test ------------------------------------------------------------

  private reveal() {
    this.phase = 'reveal';
    const keyIndex = this.steps.findIndex((s) => s.key);
    const quality: Result = this.results[keyIndex] ?? 'right';
    const entry: CakeEntry = { n: this.gallery.length + 1, recipe: BASQUE.id, flavor: this.flavor.id, quality, date: new Date().toISOString() };
    this.gallery.push(entry);
    saveGallery(this.gallery);
    this.lastEntry = entry;
    this.rebuildShelf();
    this.clearLeftovers();

    this.k.rail.goTo('counter');
    this.pan.visible = false;
    const cake = makeCake(this.flavor.id, quality);
    cake.position.copy(this.k.at(SLOT.front, 0));
    this.k.scene.add(cake);
    this.cake = cake;
    this.confetti.burst(cake.position.clone().add(new THREE.Vector3(0, 0.12, 0)));
    sound.play('confetti');

    this.hud.heading('Ta-da!');
    this.hud.tag(`Cake #${entry.n} · ${displayName(BASQUE, this.flavor.id)}`);
    this.hud.hint('Drag the cake to the cat for a taste test!');
    this.hud.verdict(null);
    this.hud.buttons([
      { label: 'Bake another', onClick: () => this.idle() },
      { label: 'Shelf', ghost: true, onClick: () => this.k.rail.goTo('fridge') },
    ]);
    this.cat.say(`${BASQUE.lines[quality]} You made it, ${PLAYER_NAME}!`, quality === 'right' ? 'love' : 'excited');

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
  }

  private eat() {
    if (!this.cake || !this.feed) return;
    this.k.pointer.handlers.splice(this.k.pointer.handlers.indexOf(this.feed), 1);
    this.feed = null;
    this.eating = true;
    this.eatT = 0;
    this.chomps = 0;
    this.eatFrom.copy(this.cake.position);
    this.hud.hint('');
    this.cat.chomp();
    this.cat.say('nom nom nom…', 'yum');
  }

  private finishEating() {
    this.eating = false;
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
    if (this.eating && this.cake) {
      this.eatT += dt;
      const e = ease(this.eatT / 0.8);
      this.cake.position.lerpVectors(this.eatFrom, this.cat.mouth(), e);
      this.cake.scale.setScalar(Math.max(0.001, 1 - e * 0.98));
      if (this.eatT > 0.1 + this.chomps * 0.25 && this.chomps < 3) { this.chomps++; sound.play('chomp'); }
      if (this.eatT > 0.95) this.finishEating();
    }
  }

  // ---- shelf --------------------------------------------------------------------------

  private rebuildShelf() {
    for (const c of this.shelfCakes) this.k.scene.remove(c.obj);
    this.shelfCakes = [];
    const entries = this.gallery.slice(-12).reverse();
    const n = entries.length;
    const spacing = n <= 5 ? 0.095 : 0.04;
    entries.forEach((entry, i) => {
      const obj = entry.recipe === 'basque' ? makeCake(entry.flavor ?? 'classic', entry.quality) : makeOtherCake(entry.recipe);
      obj.scale.setScalar(n <= 5 ? 0.48 : 0.22);
      obj.position.copy(this.shelf.position).add(new THREE.Vector3((i - (n - 1) / 2) * spacing, 0.008, 0));
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

  /** Things a test driver can aim at right now. */
  targets(): Record<string, THREE.Vector3> {
    const out: Record<string, THREE.Vector3> = this.current?.targets?.() ?? {};
    out.book = this.book.position.clone();
    out.cat = this.cat.mouth();
    if (this.cake) out.cake = this.cake.position.clone();
    this.shelfCakes.forEach((c, i) => { out[`shelf${i}`] = c.obj.position.clone(); });
    return out;
  }
}

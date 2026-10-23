// Step: bake it HOT. Drag the pan over the oven: the door falls open like a shelf, the pan
// lands on it and slides in onto the rack, and the door swings shut. Then hold to bake while
// the top browns through the window (the view leans in to the glass): pale, golden, BURNT,
// charred, with the cat calling each stage. The sweet spot is a burnt top: this is the key
// Step. Letting go while the top is still pale only pauses the oven (nothing has happened
// yet), so the bake always ends on a stage the player could see. Then the door drops, steam
// rolls out, the pan slides out onto the door and rests there while a pill names the stage.
import * as THREE from 'three';
import { SLOT } from '../kitchen';
import type { Pose } from '../camera';
import { Carry, HoldMeter } from '../gestures';
import { ParticlePool } from '../particles';
import { sound, type Loop } from '../sound';
import type { PointerHandler } from '../input';
import { motion, Spring, easeOutCubic, easeInOutCubic, easeOutElastic } from '../motion';
import type { Expr } from '../cat';
import { ease, type Result, type StepContext, type StepRunner } from './step';

export type BakeStageId = 'pale' | 'golden' | 'burnt' | 'charred';

/**
 * The bake, as data: how long a full hold takes (seconds) and the four stages the top goes
 * through, each until a fraction of that. The burnt stage is the sweet spot. This is the one
 * rule for the Result, the HUD's bake gauge (the one judge) and the cake's colour. The
 * sweet window is 0.55-0.88 of an 8 s hold (2.6 s). A burnt top is a caramel mahogany and a
 * charred one a dark espresso (and it smokes), so the stages tell apart through the window.
 */
export const BAKE: { duration: number; stages: { id: BakeStageId; until: number; top: number; sweet?: boolean }[] } = {
  duration: 8,
  stages: [
    { id: 'pale', until: 0.30, top: 0xfcebc4 },
    { id: 'golden', until: 0.55, top: 0xe0b56a },
    { id: 'burnt', until: 0.88, top: 0x8a4a22, sweet: true },
    { id: 'charred', until: 1, top: 0x3a2418 },
  ],
};

/** The sweet window, from the stage list. */
const SWEET = BAKE.stages.findIndex((s) => s.sweet);
export const BAKE_SWEET: [number, number] = [BAKE.stages[SWEET - 1].until, BAKE.stages[SWEET].until];

/** Which stage a progress (0..1) is in. */
export function stageAt(p: number) {
  const i = BAKE.stages.findIndex((s) => p < s.until);
  return i < 0 ? BAKE.stages.length - 1 : i;
}

/**
 * The top's colour at a progress: inside a stage it drifts a third of the way toward the
 * next stage's colour, and at a boundary it snaps on, so each stage reads as its own colour
 * through the window (the third is tuned by eye).
 */
export function topColor(p: number, out = new THREE.Color()) {
  const i = stageAt(p);
  const s = BAKE.stages[i];
  const from = i > 0 ? BAKE.stages[i - 1].until : 0;
  const u = THREE.MathUtils.clamp((p - from) / (s.until - from), 0, 1);
  const next = BAKE.stages[i + 1]?.top ?? 0x2a1a10;
  return out.set(s.top).lerp(new THREE.Color(next), u / 3);
}

/** The Result of a bake that ended at this progress: golden one stage short (under, mid), burnt right (bussin), charred one past (over, ass). */
export function bakeResult(p: number): Result {
  const id = BAKE.stages[stageAt(p)].id;
  return id === 'burnt' ? 'right' : id === 'charred' ? 'over' : 'under';
}

/**
 * Everything the top looks like at a progress, shared with makeCake so the reveal matches
 * the pan: colour, how much the dome has risen (0.6 flat batter .. 1), and the scorch patches.
 */
export function bakeLook(p: number) {
  const golden = BAKE.stages[1].until;
  const burnt = BAKE.stages[2].until;
  // The dome rises through pale and golden, then settles back 5% as the top scorches.
  const puff = p <= golden ? 0.6 + 0.4 * ease(p / golden) : 1 - 0.05 * THREE.MathUtils.smoothstep(p, golden, burnt);
  const patchOpacity = THREE.MathUtils.smoothstep(p, 0.45, burnt) * 0.85;
  // Patches are always a scorch darker than the top, and darker still once it chars.
  const top = topColor(p);
  const patch = top.clone().multiplyScalar(0.55 - 0.2 * THREE.MathUtils.smoothstep(p, burnt, 1));
  return { top, puff, patch, patchOpacity };
}

/** How the oven's knob and thermometer turn with the heat: the knob 0..150 degrees, the pointer over a 270 degree sweep. */
export const KNOB_TURN = (150 * Math.PI) / 180;

/** The oven light's intensity at full heat (candela). */
const LIGHT = 0.005;

/** How much the top glows its own colour at full heat, so its stage reads through the glass (tuned by eye). */
const TOP_GLOW = 0.35;

const HINT = "Press and hold until it's BURNT!";
const PAUSED = 'Keep holding, it needs to get HOT';

/**
 * The door, as bake.ts moves it. It is hinged at the bottom of the opening and lies open a
 * touch past flat, like a shelf the pan can sit on (1.65 rad; 4.6 degrees of droop). Its
 * length and thickness match OVEN in props.ts.
 */
const DOOR = {
  open: 1.65,
  /** The one bounce off the hinge stop when it lands open (rad). */
  bounce: (4 * Math.PI) / 180,
  /** Seconds to fall open, bounce included. */
  openTime: 0.5,
  len: 0.136,
  w: 0.29,
  t: 0.012,
  /** Where along the open door the pan's centre sits: its back edge just over the hinge. */
  panAt: 0.08,
};

/** The burner's roar: up to full this fast while held (1/s), so it answers the finger (by ear). */
const FLAME_UP = 7;

/**
 * The carried pan's base height (m): 2 cm over the open door and low enough that the lining's
 * crinkled top (7.2 cm up) clears the opening's 19.5 cm head by almost 3 cm, so the pan is seen
 * going in through the mouth and never across the oven's front or roof.
 */
const HOLD_Y = 0.095;

/** Seconds for each beat of the choreography (tuned by eye on a phone). */
const BEAT = { landing: 0.25, sliding: 0.7, slidingOut: 0.6, resting: 2.2, steam: 1.2, toCounter: 0.45 };

/** The HUD's bake gauge, the one judge: the four stages as coloured bands, labelled, the goal marked. */
const GAUGE = BAKE.stages.map((s) => ({
  label: s.sweet ? 'BURNT' : s.id,
  color: `#${s.top.toString(16).padStart(6, '0')}`,
  until: s.until,
  goal: !!s.sweet,
}));

/** What the #tag pill and the cat say once the bake is out, by Result: the pill names where it stopped and the goal. */
const OUTCOME: Record<Result, { tag: string; line: string; expr: Expr }> = {
  right: { tag: 'BURNT top: bussin! The goal!', line: 'Look at that top! Chef\'s kiss!', expr: 'love' },
  under: { tag: 'Golden: mid', line: 'Golden: mid. Too light for Basque, hold till BURNT!', expr: 'ooh' },
  over: { tag: 'Charred: ass', line: 'Charred: ass. Let go at BURNT next time!', expr: 'ooh' },
};

/** What the cat calls as each stage arrives (pale is where the bake starts). */
const CALLS: Partial<Record<BakeStageId, { line: string; expr: Expr }>> = {
  golden: { line: 'Going golden... keep holding!', expr: 'excited' },
  burnt: { line: 'THAT\'s the burnt top we want! Let go!', expr: 'excited' },
  charred: { line: 'Okay okay, smoky!! Let go!', expr: 'ooh' },
};

type Phase = 'carry' | 'landing' | 'sliding' | 'closing' | 'bake' | 'opening' | 'sliding-out' | 'resting' | 'served' | 'leaving';

/** A soft round puff for steam and heat shimmer, drawn once. */
let puffTexture: THREE.CanvasTexture | null = null;
function puffTex() {
  if (puffTexture) return puffTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  puffTexture = new THREE.CanvasTexture(c);
  return puffTexture;
}

/**
 * A handful of sprites that rise, swell and fade: steam out of the open door, the heat
 * shimmer over the vent. Never more than a dozen, so each keeps its own material.
 */
class Puffs {
  private readonly items: { s: THREE.Sprite; m: THREE.SpriteMaterial; age: number; life: number; v: THREE.Vector3; size: [number, number]; peak: number }[] = [];
  readonly group = new THREE.Group();

  constructor(n: number, color: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.SpriteMaterial({ map: puffTex(), color, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 4;
      this.group.add(s);
      this.items.push({ s, m, age: 0, life: 0, v: new THREE.Vector3(), size: [0, 0], peak: 0 });
    }
  }

  get live() { return this.items.filter((p) => p.s.visible).length; }

  emit(at: THREE.Vector3, v: THREE.Vector3, life: number, size: [number, number], peak: number) {
    const p = this.items.find((q) => !q.s.visible);
    if (!p) return;
    p.s.position.copy(at);
    p.v.copy(v);
    p.age = 0;
    p.life = life;
    p.size = size;
    p.peak = peak;
    p.s.visible = true;
  }

  update(dt: number) {
    for (const p of this.items) {
      if (!p.s.visible) continue;
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) { p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(Math.exp(-0.8 * dt));
      p.s.scale.setScalar(p.size[0] + (p.size[1] - p.size[0]) * easeOutCubic(u));
      // in quickly, out slowly
      p.m.opacity = p.peak * Math.min(1, u / 0.15) * (1 - u) * (1 - u);
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.group);
    for (const p of this.items) p.m.dispose();
  }
}

export class BakeStep implements StepRunner, PointerHandler {
  private phase: Phase = 'carry';
  private carry!: Carry;
  private readonly meter = new HoldMeter(BAKE.duration, BAKE_SWEET);
  private holding = false;
  private door!: THREE.Group;
  private glass!: THREE.Mesh;
  private light!: THREE.PointLight;
  private elements: THREE.MeshStandardMaterial[] = [];
  private lamp!: THREE.MeshStandardMaterial;
  private knob!: THREE.Object3D;
  private pointer!: THREE.Object3D;
  private fill!: THREE.Mesh;
  private fillMat!: THREE.MeshStandardMaterial;
  private crown!: THREE.Object3D;
  private dome!: THREE.Mesh;
  private domeMat!: THREE.MeshStandardMaterial;
  private patchMat!: THREE.MeshStandardMaterial;
  private smoke!: ParticlePool;
  private steam!: Puffs;
  private shimmer!: Puffs;
  private smokeT = 0;
  private steamT = 0;
  private steamLeft = 0;
  private shimmerT = 0;
  private stage = 0;
  private heat = 0;
  /** The burner, 0..1: up quickly while held, off the moment the finger lifts (the oven loop's level). */
  private flame = 0;
  private loop: Loop | null = null;
  private sizzle: Loop | null = null;
  private ticker: Loop | null = null;
  private slammed = false;
  private animT = 0;
  private puffT = 99;
  private paused = false;
  private panArrived = false;
  private result: Result = 'right';
  private leaveDone: (() => void) | null = null;

  // The door: either falling open on a timed curve, or swinging shut on a spring that
  // bounces off the frame.
  private doorAngle = 0;
  private doorMode: 'still' | 'opening' | 'closing' = 'still';
  private doorFrom = 0;
  private doorT = 0;
  private readonly doorSpring = new Spring(0, 100, 0.6);
  private doorMax = 0;

  // The pan's lean, springing flat after it is let go.
  private readonly leanX = new Spring(0, 260, 0.5);
  private readonly leanZ = new Spring(0, 260, 0.5);

  private readonly from = new THREE.Vector3();
  private readonly inside = new THREE.Vector3();
  private readonly onDoor = new THREE.Vector3();
  private readonly counter = new THREE.Vector3();
  private outPos = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(private readonly ctx: StepContext) {}

  start() {
    const { k, pan, oven, hud, station } = this.ctx;
    this.door = oven.getObjectByName('door') as THREE.Group;
    this.glass = oven.getObjectByName('glass') as THREE.Mesh;
    this.light = oven.getObjectByName('light') as THREE.PointLight;
    oven.traverse((o) => { if (o.name === 'element') this.elements.push((o as THREE.Mesh).material as THREE.MeshStandardMaterial); });
    this.lamp = (oven.getObjectByName('lamp') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    this.knob = oven.getObjectByName('knob')!;
    this.pointer = oven.getObjectByName('pointer')!;
    this.fill = pan.getObjectByName('fill') as THREE.Mesh;
    this.fillMat = this.fill.material as THREE.MeshStandardMaterial;
    this.crown = pan.getObjectByName('crown')!;
    this.dome = pan.getObjectByName('dome') as THREE.Mesh;
    this.domeMat = this.dome.material as THREE.MeshStandardMaterial;
    this.patchMat = (pan.getObjectByName('patch') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    this.outPos = k.at(SLOT.front, station);
    // Where the pan goes back down once the bake is done: on the counter just clear of the
    // open door's swing (its far edge reaches 9 cm in front of the oven).
    this.counter.copy(this.outPos).add(new THREE.Vector3(0, 0, 0.04));
    // On the rack, forward against the glass so the view looks down over the collar onto the top.
    this.inside.copy(oven.position).add(new THREE.Vector3(0, oven.userData.rackY as number, 0.055));
    this.doorAngle = this.door.rotation.x;

    // Grey puffs off a charred top; they rise a few centimetres and fade under the ceiling.
    this.smoke = new ParticlePool(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x8d837e, transparent: true, opacity: 0.45, depthWrite: false }),
      12,
      { gravity: -0.05, drag: 1.5, jitter: 0.06, fade: 0.6 },
    );
    this.smoke.mesh.castShadow = false;
    this.smoke.mesh.renderOrder = 3;
    k.scene.add(this.smoke.mesh);
    this.steam = new Puffs(8, 0xffffff);
    this.shimmer = new Puffs(8, 0xfff0dc);
    k.scene.add(this.steam.group, this.shimmer.group);

    this.applyLook(0);
    this.crown.visible = false;
    this.setDial(0);
    hud.tag(null);
    k.rail.focus = this.pose('door');

    // The filled pan slides in from the Stove's park slot; it can be picked up once it is there.
    pan.position.copy(k.at(SLOT.park, station));
    pan.rotation.set(0, 0, 0);
    pan.visible = true;
    k.glide(pan, this.outPos, 0.5).then(() => {
      this.panArrived = true;
      if (this.phase === 'carry') k.pointer.handlers.unshift(this.carry);
    });
    this.carry = new Carry(k, [{ obj: pan, home: this.outPos.clone(), placed: false }], {
      holdY: HOLD_Y,
      grabPx: 90,
      mass: 1, // a springform full of batter
      onGrab: () => this.openDoor(),
      onDrop: (_item, pos) => {
        if (!this.overDoor(pos)) { this.closeDoor(); return false; }
        this.phase = 'landing';
        this.animT = 0;
        this.from.copy(pos);
        this.leanX.jump(pan.rotation.x);
        this.leanZ.jump(pan.rotation.z);
        hud.hint('In it goes…');
        return true;
      },
    });
    hud.hint('Drag the pan into the oven, then hold');
    hud.meter('pips');
    hud.setPips(1, 0);
  }

  /** Anywhere over the open door or the oven's mouth takes the pan. */
  private overDoor(pos: THREE.Vector3) {
    const o = this.ctx.oven.position;
    const front = o.z + 0.15; // the oven's front face
    return Math.abs(pos.x - o.x) < 0.18 && pos.z > front - 0.12 && pos.z < front + DOOR.len + 0.03;
  }

  // ---- Hold to bake (only in the bake phase) ---------------------------------------------

  down() {
    if (this.phase !== 'bake') return false;
    this.holding = true;
    this.loop ??= sound.loop('oven');
    this.sizzle ??= sound.loop('sizzle');
    this.ticker ??= sound.loop('tick'); // the timer runs while the oven is on
    if (this.paused) { this.paused = false; this.ctx.hud.hint(HINT); }
    return true;
  }

  move() {}

  up() {
    if (!this.holding) return;
    this.holding = false;
    // the burner goes off: the oven drops to its idle hum, the sizzle and the timer stop
    this.flame = 0;
    this.loop?.set(0.35);
    this.sizzle?.set(0);
    this.ticker?.stop();
    this.ticker = null;
    // Still pale: nothing to judge yet, so the oven just idles until the next hold.
    if (BAKE.stages[stageAt(this.meter.progress)].id === 'pale') {
      this.paused = true;
      this.ctx.hud.hint(PAUSED);
      return;
    }
    this.finishBake();
  }

  update(dt: number, t: number) {
    const { pan, hud } = this.ctx;
    this.updateDoor(dt);
    // three's lights are physical: 5 mcd a few centimetres over the top is a warm glow that
    // still lets the stage colours read (at 1.2 the top blows out to white; tuned by eye).
    this.light.intensity = this.heat * LIGHT;
    this.setDial(this.heat);
    for (const m of this.elements) m.emissiveIntensity = this.heat * 2.2;
    this.lamp.emissiveIntensity = this.holding ? 1.2 : this.phase === 'bake' ? 0.15 : 0;
    // The oven light alone leaves the top a dim tan whatever its stage; a glow of its own
    // colour with the heat makes golden read gold and burnt a deep brown through the glass.
    this.domeMat.emissive.copy(this.domeMat.color).multiplyScalar(TOP_GLOW * this.heat);
    this.fillMat.emissive.copy(this.domeMat.emissive);
    this.smoke.update(dt);
    this.steam.update(dt);
    this.shimmer.update(dt);
    this.puffT += dt;

    switch (this.phase) {
      case 'carry':
        this.carry.update(dt, t);
        break;
      case 'landing': {
        // Dropped over the door: the pan falls the last few centimetres onto it and squashes.
        this.animT += dt;
        const u = Math.min(1, this.animT / BEAT.landing);
        this.doorSpot(this.onDoor);
        pan.position.x = this.from.x + (this.onDoor.x - this.from.x) * easeOutCubic(u);
        pan.position.z = this.from.z + (this.onDoor.z - this.from.z) * easeOutCubic(u);
        pan.position.y = this.from.y + (this.onDoor.y - this.from.y) * u * u; // falling: quicker as it goes
        this.leanTo(this.doorAngle - Math.PI / 2, dt);
        if (u >= 1) {
          motion.squash(pan, 0.1, 0.22);
          sound.play('clink', { gain: 0.4, rate: 0.8 }); // the tin on the door's glass
          this.phase = 'sliding';
          this.animT = 0;
          this.crown.visible = true;
          this.applyLook(0);
        }
        break;
      }
      case 'sliding': {
        // Along the door and onto the rack, levelling out as it goes.
        this.animT += dt;
        const u = easeInOutCubic(this.animT / BEAT.sliding);
        this.doorSpot(this.onDoor);
        pan.position.lerpVectors(this.onDoor, this.inside, u);
        this.keepAboveDoor(pan.position);
        this.leanTo((this.doorAngle - Math.PI / 2) * (1 - u), dt);
        if (this.animT >= BEAT.sliding) {
          pan.position.copy(this.inside);
          sound.play('rack', { gain: 0.5 }); // onto the wire rack
          this.phase = 'closing';
          this.closeDoor();
        }
        break;
      }
      case 'closing':
        this.leanTo(0, dt);
        if (this.doorMode === 'still') this.beginBake();
        break;
      case 'bake': {
        // The elements glow up while held (hotter as it goes) and cool to a low idle when let go.
        const want = this.holding ? 0.35 + 0.65 * this.meter.progress : 0.15;
        this.heat += (want - this.heat) * (1 - Math.exp(-4 * dt));
        if (this.holding) {
          this.meter.advance(dt);
          // the burner roars up, the top sizzles more as it browns, the timer ticks faster
          this.flame += (1 - this.flame) * (1 - Math.exp(-FLAME_UP * dt));
          const p = this.meter.progress;
          this.loop?.set(0.35 + 0.65 * this.flame, { heat: this.heat });
          this.sizzle?.set(p * p, { stage: BAKE.stages[stageAt(p)].id });
          this.ticker?.set(1, { rate: 1 + p });
          // the cat leans over the edge to watch the top through the window
          this.ctx.cat.leanTo(this.glass.getWorldPosition(this.v), 1);
          const stage = stageAt(this.meter.progress);
          if (stage !== this.stage) this.enterStage(stage);
          if (this.meter.progress >= 1) { this.finishBake(true); break; }
          this.shimmerFrame(dt);
        }
        if (BAKE.stages[this.stage].id === 'charred') this.puffSmoke(dt);
        this.applyLook(this.meter.progress, dt);
        hud.setBake(this.meter.progress, stageAt(this.meter.progress));
        break;
      }
      case 'opening':
        this.animT += dt;
        this.heat = Math.max(0, this.heat - dt * 2);
        this.steamFrame(dt);
        if (this.animT >= DOOR.openTime + 0.05) {
          this.phase = 'sliding-out';
          this.animT = 0;
          sound.play('rack', { gain: 0.45, rate: 1.05 }); // drawn off the rack
        }
        break;
      case 'sliding-out': {
        this.animT += dt;
        this.heat = Math.max(0, this.heat - dt * 2);
        this.steamFrame(dt);
        const u = easeInOutCubic(this.animT / BEAT.slidingOut);
        this.doorSpot(this.onDoor);
        pan.position.lerpVectors(this.inside, this.onDoor, u);
        this.keepAboveDoor(pan.position);
        pan.rotation.set((this.doorAngle - Math.PI / 2) * u, 0, 0);
        if (this.animT >= BEAT.slidingOut) this.rest();
        break;
      }
      case 'resting':
        this.animT += dt;
        this.steamFrame(dt);
        this.panOnDoor();
        if (this.animT >= BEAT.resting) {
          this.phase = 'served';
          this.ctx.done(this.result);
        }
        break;
      case 'served':
        this.panOnDoor();
        break;
      case 'leaving': {
        // Lifted off the door onto the counter in front, then the door swings shut behind it.
        this.animT += dt;
        if (this.animT <= BEAT.toCounter) {
          const u = easeInOutCubic(this.animT / BEAT.toCounter);
          pan.position.lerpVectors(this.from, this.counter, u);
          pan.position.y += Math.sin(u * Math.PI) * 0.04;
          pan.rotation.x = (this.doorAngle - Math.PI / 2) * (1 - u);
          if (this.animT + dt > BEAT.toCounter) {
            pan.position.copy(this.counter);
            pan.rotation.set(0, 0, 0);
            motion.squash(pan, 0.08, 0.2);
            sound.play('drop', { gain: 0.5, rate: 0.85 });
            this.closeDoor();
          }
        } else if (this.doorMode === 'still') {
          this.phase = 'served';
          this.leaveDone?.();
          this.leaveDone = null;
        }
        break;
      }
    }
    // The crown sits on whatever height the pour left the batter at, puffing with an
    // elastic wobble when the top turns BURNT.
    this.crown.position.y = this.fill.position.y + this.fill.scale.y / 2;
    if (this.puffT < 0.9) {
      const u = this.puffT / 0.9;
      const s = 1 + 0.18 * (1 - easeOutElastic(u)) * Math.min(1, u / 0.06);
      this.crown.scale.set(1, s, 1);
    } else this.crown.scale.set(1, 1, 1);
  }

  // ---- the door --------------------------------------------------------------------------

  private openDoor() {
    if (this.doorMode === 'opening' || this.doorAngle >= DOOR.open - 1e-3) return;
    this.doorMode = 'opening';
    this.doorFrom = this.doorAngle;
    this.doorT = 0;
    sound.play('creak', { gain: 0.5 }); // the hinge as it falls open
  }

  private closeDoor() {
    if (this.doorMode === 'closing' || this.doorAngle <= 1e-4) return;
    this.doorMode = 'closing';
    this.slammed = false;
    this.doorSpring.jump(this.doorAngle);
    this.doorSpring.set(0);
  }

  private updateDoor(dt: number) {
    if (this.doorMode === 'opening') {
      // It falls open (slow off the frame, quick at the end), hits the hinge stop at 1.65 rad
      // and bounces back up 4 degrees once. It never goes past the stop.
      this.doorT += dt;
      const fall = 0.32;
      if (this.doorT < fall) {
        const u = this.doorT / fall;
        this.doorAngle = this.doorFrom + (DOOR.open - this.doorFrom) * (1 - Math.cos((u * Math.PI) / 2));
      } else {
        const u = Math.min(1, (this.doorT - fall) / (DOOR.openTime - fall));
        this.doorAngle = DOOR.open - DOOR.bounce * Math.sin(u * Math.PI);
        if (u >= 1) { this.doorAngle = DOOR.open; this.doorMode = 'still'; }
      }
    } else if (this.doorMode === 'closing') {
      // Swung up on a springy hinge; the frame stops it at 0 and it bounces off a little.
      const sp = this.doorSpring;
      sp.step(dt);
      if (sp.value < 0) {
        // it meets the frame: a thunk, and the latch catches 40 ms later; the little bounces after are silent
        if (!this.slammed && sp.velocity < -0.6) {
          this.slammed = true;
          sound.play('door', { gain: Math.min(0.7, -sp.velocity * 0.12) });
          sound.play('latch', { gain: 0.45, delay: 0.04 });
        }
        sp.value = 0;
        sp.velocity = -sp.velocity * 0.3;
      }
      this.doorAngle = sp.value;
      if (sp.value < 1e-3 && Math.abs(sp.velocity) < 0.02) { this.doorAngle = 0; this.doorMode = 'still'; }
    }
    this.door.rotation.x = this.doorAngle;
    this.doorMax = Math.max(this.doorMax, this.doorAngle);
  }

  /** The point on the open door's top face where the pan's base sits. */
  private doorSpot(out: THREE.Vector3) {
    this.door.updateWorldMatrix(true, false);
    return this.door.localToWorld(out.set(0, DOOR.panAt, -DOOR.t / 2));
  }

  /**
   * The rack sits a centimetre above the open door's face where it meets the hinge, so a
   * straight slide would dip into the door: wherever the pan is over the door, lift it onto
   * the face.
   */
  private keepAboveDoor(p: THREE.Vector3) {
    this.door.updateWorldMatrix(true, false);
    const local = this.door.worldToLocal(this.v.copy(p));
    if (local.y < 0 || local.y > DOOR.len || local.z <= -DOOR.t / 2) return;
    local.z = -DOOR.t / 2;
    p.copy(this.door.localToWorld(local));
  }

  /** Keep the pan sitting on the door, tilted with it (the door may still be bouncing). */
  private panOnDoor() {
    const { pan } = this.ctx;
    pan.position.copy(this.doorSpot(this.onDoor));
    pan.rotation.set(this.doorAngle - Math.PI / 2, 0, 0);
  }

  /** The carried pan's lean springs back to the door's tilt (rx) and level (rz). */
  private leanTo(rx: number, dt: number) {
    const { pan } = this.ctx;
    pan.rotation.set(this.leanX.set(rx).step(dt), 0, this.leanZ.set(0).step(dt));
  }

  // ---- the bake ----------------------------------------------------------------------------

  private beginBake() {
    const { k, hud, cat } = this.ctx;
    this.phase = 'bake';
    this.ctx.pan.rotation.set(0, 0, 0);
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this.carry), 1);
    k.pointer.handlers.unshift(this);
    k.rail.focus = this.pose('window');
    hud.bakeGauge(GAUGE);
    hud.meter('bake');
    hud.setBake(this.meter.progress, stageAt(this.meter.progress));
    hud.hint(HINT);
    cat.say('Hold till the top goes really dark: BURNT!', 'excited');
  }

  private enterStage(i: number) {
    this.stage = i;
    const s = BAKE.stages[i];
    // A soft tick as golden arrives; the burnt one gets the chime (it's the one to stop on);
    // charred a falling double tock (past it, never a buzzer).
    if (s.sweet) { sound.play('chime', { gain: 0.85 }); this.puffT = 0; }
    else if (s.id === 'charred') sound.play('over', { gain: 0.7 });
    else sound.play('tick', { gain: 0.4, rate: 1.2 });
    if (s.id === 'burnt') this.ctx.hud.hint('BURNT! Let go now!');
    if (s.id === 'charred') this.ctx.hud.hint('Too dark! Let go!');
    const call = CALLS[s.id];
    if (call) this.ctx.cat.say(call.line, call.expr);
  }

  /** Heat shimmer over the vent: 4 wisps at the start of a hold, 8 at full heat. */
  private shimmerFrame(dt: number) {
    this.shimmerT -= dt;
    if (this.shimmerT > 0) return;
    const n = 4 + 4 * this.meter.progress;
    this.shimmerT = 1.1 / n; // each wisp lives ~1.1 s, so about n are in the air
    const o = this.ctx.oven.position;
    this.shimmer.emit(
      this.v.set(o.x + (Math.random() - 0.5) * 0.16, o.y + 0.215, o.z + 0.02 + (Math.random() - 0.5) * 0.08),
      this.w.set((Math.random() - 0.5) * 0.01, 0.06, 0),
      1.1, [0.02, 0.05], 0.22,
    );
  }

  /** Steam out of the open door: 8 puffs over the first 1.2 s. */
  private steamFrame(dt: number) {
    this.steamT -= dt;
    if (this.steamLeft <= 0 || this.steamT > 0) return;
    this.steamLeft--;
    this.steamT = 0.6 / 8; // all eight leave within 0.6 s and are gone by 1.2 s
    const o = this.ctx.oven.position;
    this.steam.emit(
      this.v.set(o.x + (Math.random() - 0.5) * 0.14, o.y + 0.18, o.z + 0.14),
      this.w.set((Math.random() - 0.5) * 0.02, 0.09, 0.05),
      BEAT.steam - 0.4 + Math.random() * 0.4, [0.025, 0.07], 0.55,
    );
  }

  private puffSmoke(dt: number) {
    this.smokeT -= dt;
    if (this.smokeT > 0) return;
    this.smokeT = 0.13; // ~8 puffs a second keeps about a dozen in the air (tuned by eye)
    const top = this.dome.getWorldPosition(this.v);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.04;
    this.smoke.emit({
      at: { x: top.x + Math.cos(a) * r, y: top.y + 0.01, z: top.z + Math.sin(a) * r },
      vel: { x: 0, y: 0.03, z: 0 },
      velJitter: 0.01,
      life: 1.4,
      lifeJitter: 0.3,
      scale: 0.011,
      scaleJitter: 0.004,
    });
  }

  /** Colour, rise and scorch patches for a progress; dt > 0 eases the colour change over ~0.1 s. */
  private applyLook(p: number, dt = 0) {
    const look = bakeLook(p);
    const k = dt > 0 ? 1 - Math.exp(-25 * dt) : 1;
    this.color.copy(this.domeMat.color).lerp(look.top, k);
    this.domeMat.color.copy(this.color);
    this.fillMat.color.copy(this.color);
    this.dome.scale.set(1, 0.22 * look.puff, 1);
    // Wet batter is glossy; a scorched crust is dry and matte. Without this the oven light's
    // highlight sits on the middle of a charred top and makes it read no darker than a burnt
    // one through the window (0.45 -> 0.9 from golden to charred, tuned by eye).
    this.domeMat.roughness = 0.45 + 0.45 * THREE.MathUtils.smoothstep(p, BAKE.stages[0].until, BAKE.stages[2].until);
    this.patchMat.roughness = this.domeMat.roughness; // a scorch is as matte as the crust it sits on
    this.patchMat.color.copy(look.patch);
    this.patchMat.opacity = look.patchOpacity;
    for (const c of this.dome.children) c.visible = look.patchOpacity > 0.01;
  }

  /** The knob and the thermometer's pointer at a heat (0..1): up as she holds, back down when she lets go. */
  private setDial(p: number) {
    this.knob.rotation.z = -KNOB_TURN * p;
    this.pointer.rotation.z = DIAL.start - DIAL.sweep * p;
  }

  private finishBake(timeout = false) {
    if (this.phase !== 'bake') return;
    const { hud, cat } = this.ctx;
    this.result = bakeResult(this.meter.progress);
    // The top lands exactly on the stage's colour, so the reveal cake matches what she saw.
    this.applyLook(this.meter.progress);
    this.holding = false;
    this.flame = 0;
    for (const l of [this.loop, this.sizzle, this.ticker]) l?.stop();
    this.loop = this.sizzle = this.ticker = null;
    sound.play('bell');
    sound.play('steam', { gain: 0.5, delay: 0.25 }); // the door drops and the heat rolls out
    if (timeout) cat.say('Phew! That\'s enough.', 'ooh');
    this.phase = 'opening';
    this.animT = 0;
    this.steamLeft = 8;
    this.steamT = 0;
    this.openDoor();
    // The view backs off as the door drops, so the steam and the pan coming out both show.
    this.ctx.k.rail.focus = this.pose('door');
    hud.hint('Out it comes!');
  }

  /** Out on the door: the pill names the stage it baked to and the goal, the cat says so. */
  private rest() {
    const { hud, cat } = this.ctx;
    this.phase = 'resting';
    this.animT = 0;
    this.panOnDoor();
    sound.play('drop', { gain: 0.4, rate: 1.1 }); // it stops against the door's end
    const o = OUTCOME[this.result];
    hud.tag(o.tag, `#${this.domeMat.color.getHexString()}`);
    hud.hint('');
    hud.meter('none');
    cat.say(o.line, o.expr);
  }

  /** Called by Game after done(): the pan goes to the counter and the door shuts. */
  leave() {
    this.ctx.hud.tag(null);
    if (this.phase !== 'served') return Promise.resolve();
    this.phase = 'leaving';
    this.animT = 0;
    this.from.copy(this.ctx.pan.position);
    return new Promise<void>((resolve) => { this.leaveDone = resolve; });
  }

  dispose() {
    const { k, hud } = this.ctx;
    const i = k.pointer.handlers.indexOf(this.carry);
    if (i >= 0) k.pointer.handlers.splice(i, 1);
    const j = k.pointer.handlers.indexOf(this);
    if (j >= 0) k.pointer.handlers.splice(j, 1);
    for (const l of [this.loop, this.sizzle, this.ticker]) l?.stop();
    this.light.intensity = 0;
    for (const m of this.elements) m.emissiveIntensity = 0;
    this.lamp.emissiveIntensity = 0;
    this.domeMat.emissive.setRGB(0, 0, 0);
    this.fillMat.emissive.setRGB(0, 0, 0);
    this.setDial(0);
    // The door is shut by now (leave() waits for its spring); it is never snapped here.
    this.smoke.dispose(k.scene);
    this.steam.dispose(k.scene);
    this.shimmer.dispose(k.scene);
    this.crown.scale.set(1, 1, 1);
    hud.tag(null);
    k.rail.focus = null;
  }

  /** The Step's two views: 'door' frames the pan and the oven, 'window' leans in to the glass. */
  private pose(which: 'door' | 'window') {
    return FOCUS[this.ctx.k.rail.landscape ? 'landscape' : 'portrait'][which];
  }

  /** The finger cue: the pan to carry over, then the window to hold. */
  cue() {
    if (this.phase === 'carry') return { name: 'pan', at: this.ctx.pan.position.clone() };
    if (this.phase === 'bake') return { name: 'oven', at: this.glass.getWorldPosition(new THREE.Vector3()) };
    return null;
  }

  targets() {
    const { oven, pan } = this.ctx;
    // Over the middle of the open door at the carry height: where the driver lets go.
    const over = oven.position.clone().add(new THREE.Vector3(0, HOLD_Y, 0.15 + DOOR.panAt));
    const out: Record<string, THREE.Vector3> = { pan: pan.position.clone(), ovenMouth: over, anywhere: this.outPos.clone() };
    // In the bake the whole window is the button; aim at its middle.
    if (this.phase === 'bake') out.anywhere = this.glass.getWorldPosition(new THREE.Vector3());
    // The middle of the cake's top, for a driver reading its colour through the window.
    if (this.crown.visible) out.top = this.dome.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.0154 * (this.dome.scale.y / 0.22), 0));
    return out;
  }

  progress() { return { progress: this.meter.progress, stage: BAKE.stages[stageAt(this.meter.progress)].id }; }

  meterInfo() { return { duration: this.meter.duration, sweet: this.meter.sweet }; }

  /** A rectangle in an object's own plane (z = 0), on screen in CSS pixels. */
  private screenRect(obj: THREE.Object3D, x0: number, x1: number, y0: number, y1: number) {
    obj.updateWorldMatrix(true, false);
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const p = this.ctx.k.toScreen(obj.localToWorld(this.v.set(x, y, 0)));
      l = Math.min(l, p.x); t = Math.min(t, p.y); r = Math.max(r, p.x); b = Math.max(b, p.y);
    }
    return { x: l, y: t, w: r - l, h: b - t };
  }

  /**
   * How far the pan's base sits above the door's top face (m), while the pan is over the
   * door; negative would mean it sank into it. null when it is not over the door.
   */
  private doorGap() {
    if (this.doorAngle < 1) return null;
    this.door.updateWorldMatrix(true, false);
    const local = this.door.worldToLocal(this.v.copy(this.ctx.pan.position));
    if (local.y < 0 || local.y > DOOR.len) return null;
    return -DOOR.t / 2 - local.z;
  }

  debug() {
    return {
      holding: this.holding, heat: this.heat, doorOpen: this.doorAngle / DOOR.open, doorAngle: this.doorAngle, doorMax: this.doorMax,
      panArrived: this.panArrived, carrying: !!this.carry?.held, bakePhase: this.phase, paused: this.paused,
      smoke: this.smoke.count, steam: this.steam.live, shimmer: this.shimmer.live, doorGap: this.doorGap(),
      // The oven's window: its glass door (frame and pane), and the pane alone.
      window: this.screenRect(this.door, -DOOR.w / 2, DOOR.w / 2, 0, DOOR.len),
      glass: this.screenRect(this.glass, -(this.glass.geometry as THREE.PlaneGeometry).parameters.width / 2, (this.glass.geometry as THREE.PlaneGeometry).parameters.width / 2, -(this.glass.geometry as THREE.PlaneGeometry).parameters.height / 2, (this.glass.geometry as THREE.PlaneGeometry).parameters.height / 2),
      bakeResult: this.result,
    };
  }
}

/** The thermometer's pointer: from lower-left (225 degrees) clockwise round to lower-right. props.ts draws the face to match. */
export const DIAL = { start: (225 * Math.PI) / 180, sweep: (270 * Math.PI) / 180 };

/**
 * The Step's views, relative to the Stove (tuned by eye). 'door' backs off so the pan on the
 * counter, the open door and the cat beside the oven all show; 'window' leans in to the
 * glass at the window's height, so the top fills the view while it bakes.
 */
const FOCUS: Record<'portrait' | 'landscape', Record<'door' | 'window', Pose>> = {
  // Portrait: 'window' stands 0.64 m back through a 29 degree lens, high enough to look
  // down over the parchment so the top is a wide ellipse (any higher and the door's top
  // frame hides it): the door fills ~30% of the height low in the view, the thermometer sits over
  // it, and the cat on top of the oven is whole in the upper left, watching. Any lower a
  // look point and the cat rides up under the header.
  portrait: {
    door: { y: 0.4, z: 0.62, lookY: 0.11, lookZ: -0.05 },
    window: { y: 0.5, z: 0.64, lookY: 0.24, lookZ: -0.05, fov: 29 },
  },
  landscape: {
    door: { y: 0.48, z: 0.86, lookY: 0.1, lookZ: -0.05 },
    window: { y: 0.36, z: 0.62, lookY: 0.15, lookZ: -0.05, fov: 30 },
  },
};

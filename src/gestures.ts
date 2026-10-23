// The four Gestures, as reusable pieces: Hold and Stir meters, Carry for Drag, and the
// Lean every carried thing shares.
import * as THREE from 'three';
import type { Kitchen } from './kitchen';
import type { PointerHandler } from './input';
import type { Result } from './steps/step';
import { motion, Spring, Spring3, easeOutBack, easeOutCubic } from './motion';
import { sound } from './sound';

/** The wiggle of a Nudge (seconds). */
const NUDGE_T = 0.4;

/**
 * The Nudge: a thing touched that isn't part of the Step gives a cute wiggle and a pop, and
 * nothing else happens. Never a telling-off.
 */
export function nudge(obj: THREE.Object3D) {
  sound.play('pop', { gain: 0.35, rate: 1.1 + Math.random() * 0.2 });
  return motion.wiggle(obj, NUDGE_T);
}

/** A ring that fills while you hold or stir; where you stop decides the Result. */
export class HoldMeter {
  progress = 0;
  constructor(public duration: number, public sweet: [number, number]) {}

  /**
   * Fill for dt seconds at a rate (1 = full in `duration`). A pour passes its flow, so the
   * ring fills with what actually goes in: a trickle slowly, a glug fast, nothing when tipped back.
   */
  advance(dt: number, rate = 1) {
    this.progress = Math.min(1, this.progress + (dt / this.duration) * rate);
  }

  get inSweet() { return this.progress >= this.sweet[0] && this.progress <= this.sweet[1]; }

  result(): Result {
    if (this.progress < this.sweet[0]) return 'under';
    if (this.progress <= this.sweet[1]) return 'right';
    return 'over';
  }
}

/** Counts how far a finger has travelled around a centre point. Neatness never matters. */
export class StirTracker {
  turns = 0;
  speed = 0; // radians per second, smoothed
  /** Which way round the finger goes on screen: +1 clockwise, -1 anticlockwise (smoothed). */
  dir = 0;
  private lastAngle: number | null = null;

  /** Where the finger is round the centre, 0..1 of a turn (the whisk's stroke phase for its sound). */
  get phase() { return this.lastAngle === null ? 0 : (this.lastAngle / (Math.PI * 2) + 1) % 1; }

  update(x: number, y: number, cx: number, cy: number, dt: number) {
    const a = Math.atan2(y - cy, x - cx);
    if (this.lastAngle !== null) {
      let d = a - this.lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.turns += Math.abs(d) / (Math.PI * 2);
      this.speed += (Math.abs(d) / Math.max(dt, 1e-3) - this.speed) * 0.3;
      if (d !== 0) this.dir += (Math.sign(d) - this.dir) * 0.2;
    }
    this.lastAngle = a;
  }

  lift() {
    this.lastAngle = null;
    this.speed = 0;
  }

  decay(dt: number) { this.speed *= Math.exp(-6 * dt); }
}

const LEAN_MAX = 0.4;     // rad, the most a carried thing leans
const LEAN_GAIN = 0.6;    // rad per m/s of travel
const VEL_SMOOTH = 12;    // 1/s: the velocity behind the lean is smoothed this fast, so a jittery finger never shakes it
const WOBBLE_T = 0.2;     // s, the settle wobble when a thing is put back

/**
 * How a carried thing leans into its travel: its top tips toward where it is going, a
 * spring per axis chases clamp(velocity * 0.6), and a little settle wobble when it is put
 * back. Carry and the eggs both use it, so everything in the hand feels like one hand.
 */
export class Lean {
  /** Smoothed velocity, m/s. */
  readonly vel = new THREE.Vector3();
  // Tuned by eye: stiff enough to read as a reaction, soft enough to sway past and come back.
  readonly x = new Spring(0, 180, 0.7);
  readonly z = new Spring(0, 180, 0.7);
  private wobbleT = Infinity;
  private wobbleAmp = 0;

  /** gain: rad per m/s of travel; max: the most it leans (rad). */
  constructor(private readonly gain = LEAN_GAIN, private readonly max = LEAN_MAX) {}

  /** Feed this frame's raw velocity (m/s); null lets the lean spring back to upright. */
  step(dt: number, raw: THREE.Vector3 | null) {
    const k = 1 - Math.exp(-VEL_SMOOTH * dt);
    if (raw) this.vel.lerp(raw, k);
    else this.vel.multiplyScalar(1 - k);
    const c = THREE.MathUtils.clamp;
    this.x.set(raw ? c(this.vel.z * this.gain, -this.max, this.max) : 0).step(dt);
    this.z.set(raw ? c(-this.vel.x * this.gain, -this.max, this.max) : 0).step(dt);
    this.wobbleT += dt;
  }

  /** A short damped side-to-side settle, as when a thing is set down. */
  wobble(amp = 0.08) { this.wobbleT = 0; this.wobbleAmp = amp; }

  get settling() { return this.wobbleT < WOBBLE_T; }

  /** The rotation about z the wobble adds right now. */
  get wobbleZ() {
    if (this.wobbleT >= WOBBLE_T) return 0;
    const u = this.wobbleT / WOBBLE_T;
    return this.wobbleAmp * Math.sin(u * Math.PI * 3) * (1 - u);
  }

  /** How far it leans, in radians (for the test driver). */
  get amount() { return Math.hypot(this.x.value, this.z.value); }

  apply(obj: THREE.Object3D, flutterX = 0, flutterZ = 0) {
    obj.rotation.set(this.x.value + flutterX, 0, this.z.value + flutterZ + this.wobbleZ);
  }

  /** Carry on from another Lean's state (a held thing let go keeps its sway). */
  copy(o: Lean) {
    this.vel.copy(o.vel);
    this.x.jump(o.x.value); this.x.velocity = o.x.velocity;
    this.z.jump(o.z.value); this.z.velocity = o.z.velocity;
    return this;
  }

  reset() { this.vel.set(0, 0, 0); this.x.jump(0); this.z.jump(0); this.wobbleT = Infinity; }
}

export interface CarryItem {
  obj: THREE.Object3D;
  home: THREE.Vector3;
  placed: boolean;
}

export interface CarryOptions {
  holdY: number;
  grabPx?: number;
  /** Paper flutters more than a pan (rad of sway while carried). */
  flutter?: number;
  onGrab?(item: CarryItem): void;
  onMove?(item: CarryItem, pos: THREE.Vector3): void;
  /** Return true if the item was placed (the callback is responsible for where it sits now). */
  onDrop(item: CarryItem, pos: THREE.Vector3): boolean;
  /** What squashes when a drop lands (the item by default; null for nothing). */
  receiver?(item: CarryItem): THREE.Object3D | null;
  /** How heavy it is in the hand, kg: a heavier thing is a louder grab and a deeper set-down. */
  mass?: number;
}

/** Grab and set-down loudness for a mass (kg): a sheet of paper whispers, a full pan knocks (by ear). */
const handGain = (mass: number) => THREE.MathUtils.clamp(0.15 + mass * 0.5, 0.15, 0.7);

const GRAB_T = 0.12;      // s to lift off on grab
const GRAB_LIFT = 0.015;  // m it rises as it is picked up
const GRAB_SCALE = 0.06;  // and how much it swells
const RETURN_T = 0.35;    // s back home after a miss
/**
 * 1/s. The hold plane is above the thing on the counter, so the finger's ray meets it nearer
 * the camera than the thing: picked up, it would lurch toward you. Instead it keeps the
 * difference and lets it go over about a third of a second, so it lifts straight up.
 */
export const GRAB_OFFSET_DECAY = 6;

interface Returning { item: CarryItem; from: THREE.Vector3; t: number; lean: Lean; lift: number; base: THREE.Vector3; wobbled: boolean }

/**
 * Drag: pick a thing up and it follows the finger on a spring, a touch behind, leaning into
 * its travel. It lifts and swells a little as it is picked up; a good drop squashes it (or
 * what it lands in), a miss carries it home with a small overshoot and a settle wobble.
 */
export class Carry implements PointerHandler {
  held: CarryItem | null = null;
  readonly pos = new THREE.Vector3();
  // Tuned by eye: close behind the finger without feeling glued to it.
  private readonly follow = new Spring3(undefined, 220, 0.9);
  private readonly lean = new Lean();
  private readonly base = new THREE.Vector3(1, 1, 1);
  private grabK = 0;
  private readonly grabOff = new THREE.Vector3();
  private pointer = { x: 0, y: 0 };
  private returning: Returning[] = [];
  private readonly travel = new THREE.Vector3();
  private readonly prevQ = new THREE.Quaternion();
  private hasPrev = false;
  /** The biggest rotation the held or returning thing made in one frame (rad), for the test driver. */
  maxRotDelta = 0;

  constructor(private readonly k: Kitchen, readonly items: CarryItem[], private readonly o: CarryOptions) {}

  /** Smoothed velocity of the held thing, m/s. */
  get vel() { return this.lean.vel; }

  down(x: number, y: number) {
    if (this.held) return false;
    let best: CarryItem | null = null;
    let bestD = this.o.grabPx ?? 60;
    for (const it of this.items) {
      if (it.placed || this.returning.some((r) => r.item === it)) continue;
      const d = this.k.screenDist(x, y, it.obj.position);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (!best) return false;
    motion.release(best.obj); // a Nudge still wiggling it gives it back first
    this.held = best;
    this.pointer = { x, y };
    this.base.copy(best.obj.scale);
    this.grabK = 0;
    this.pos.copy(best.obj.position);
    this.follow.jump(this.pos);
    const f = this.k.fingerAt(x, y, this.o.holdY);
    this.grabOff.set(f ? this.pos.x - f.x : 0, 0, f ? this.pos.z - f.z : 0);
    this.lean.reset();
    this.hasPrev = false;
    const m = this.o.mass ?? 0.3;
    sound.play('grab', { gain: handGain(m), rate: THREE.MathUtils.clamp(1.3 - m * 0.4, 0.8, 1.3) });
    this.o.onGrab?.(best);
    return true;
  }

  move(x: number, y: number) { this.pointer = { x, y }; }

  up() {
    const it = this.held;
    if (!it) return;
    this.held = null;
    if (this.o.onDrop(it, it.obj.position.clone())) {
      it.obj.scale.copy(this.base);
      const r = this.o.receiver ? this.o.receiver(it) : it.obj;
      if (r) motion.squash(r, 0.08, 0.25);
      it.placed = true;
      return;
    }
    this.returning.push({ item: it, from: it.obj.position.clone(), t: 0, lean: new Lean().copy(this.lean), lift: this.grabK, base: this.base.clone(), wobbled: false });
  }

  update(dt: number, t: number) {
    const it = this.held;
    const fl = this.o.flutter ?? 0.02;
    if (it) {
      const target = this.k.fingerAt(this.pointer.x, this.pointer.y, this.o.holdY);
      this.grabOff.multiplyScalar(Math.exp(-GRAB_OFFSET_DECAY * dt));
      if (target) this.follow.set(target.add(this.grabOff));
      this.follow.step(dt);
      this.pos.copy(this.follow.value);
      // it leans with the hand's travel, not with the settling under the finger
      this.lean.step(dt, this.travel.copy(this.follow.velocity).addScaledVector(this.grabOff, GRAB_OFFSET_DECAY));
      this.grabK = Math.min(1, this.grabK + dt / GRAB_T);
      const g = easeOutBack(this.grabK);
      it.obj.position.copy(this.pos);
      it.obj.position.y += GRAB_LIFT * g;
      it.obj.scale.copy(this.base).multiplyScalar(1 + GRAB_SCALE * g);
      this.lean.apply(it.obj, Math.sin(t * 9) * fl, Math.cos(t * 7) * fl);
      this.track(it.obj);
      this.o.onMove?.(it, this.pos);
    }
    for (const r of this.returning) {
      r.t = Math.min(1, r.t + dt / RETURN_T);
      const obj = r.item.obj;
      // along the counter with a small overshoot past home; up and down in a plain arc
      const e = easeOutBack(r.t);
      obj.position.lerpVectors(r.from, r.item.home, e);
      obj.position.y = r.from.y + (r.item.home.y - r.from.y) * easeOutCubic(r.t) + Math.sin(r.t * Math.PI) * 0.03;
      obj.scale.copy(r.base).multiplyScalar(1 + GRAB_SCALE * r.lift * (1 - easeOutCubic(r.t)));
      r.lean.step(dt, null); // the lean springs back upright on the way
      if (r.t >= 1 && !r.wobbled) {
        r.wobbled = true;
        r.lean.wobble(0.08);
        const m = this.o.mass ?? 0.3;
        sound.play('drop', { gain: handGain(m) * 0.8, rate: THREE.MathUtils.clamp(1.25 - m * 0.4, 0.8, 1.25) });
      }
      r.lean.apply(obj);
      if (!this.held) this.track(obj);
    }
    this.returning = this.returning.filter((r) => r.t < 1 || r.lean.settling);
    if (!it && !this.returning.length) this.hasPrev = false;
  }

  /** How the hand feels right now, for the test driver. */
  info() { return { lean: this.lean.amount, settling: this.returning.length > 0 }; }

  private track(obj: THREE.Object3D) {
    if (this.hasPrev) this.maxRotDelta = Math.max(this.maxRotDelta, this.prevQ.angleTo(obj.quaternion));
    this.prevQ.copy(obj.quaternion);
    this.hasPrev = true;
  }
}

/**
 * A lifted finger is a pause, not the end of a Stir or Pour: the Step only ends once the finger
 * has stayed up this long (s), so lifting to re-grip never locks in a Result. At or past the
 * sweet start it ends soon (0.8 s); short of it, past `min`, it waits much longer while the hint
 * says to keep going; under `min` it waits for the finger.
 */
export function pauseEnds(progress: number, sweet: [number, number], min: number): number {
  if (progress >= sweet[0]) return 0.8;
  if (progress >= min) return 2.5;
  return Infinity;
}

// The motion toolkit: springs, eases, a tiny tween sequencer and the little
// pop/squash/wiggle moves that make props feel Tactile. Everything here is kinematic
// (it moves meshes, never Rapier bodies) and allocation-free per frame: the only
// Vector3s made here are a Spring3's own state, once, when it is built.
import * as THREE from 'three';

export type Ease = (t: number) => number;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

// ---- eases ----------------------------------------------------------------------------

export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - clamp01(t), 3);
/** The ease every Step already used; kept under its old name. */
export const ease = easeOutCubic;
export const easeInOutCubic: Ease = (t) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const BACK = 1.7; // overshoot; peaks at about 1.10, a visible but polite bounce
export const easeOutBack: Ease = (t) => {
  t = clamp01(t) - 1;
  return 1 + (BACK + 1) * t * t * t + BACK * t * t;
};
export const easeInBack: Ease = (t) => {
  t = clamp01(t);
  return (BACK + 1) * t * t * t - BACK * t * t;
};
export const easeOutElastic: Ease = (t) => {
  t = clamp01(t);
  if (t === 0 || t === 1) return t;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};
export const linear: Ease = clamp01;

// ---- springs ----------------------------------------------------------------------------

// Closed-form damped spring (Ryan Juckett's derivation): exact for any dt, so a hitch
// or a hidden tab never makes a spring explode. The four coefficients are computed once
// per step into this scratch and applied per component.
const C = { pp: 1, pv: 0, vp: 0, vv: 1 };

function springCoefficients(stiffness: number, dampingRatio: number, dt: number) {
  const omega = Math.sqrt(stiffness);
  const zeta = Math.max(0, dampingRatio);
  if (dt <= 0 || omega < 1e-6) { C.pp = 1; C.pv = dt; C.vp = 0; C.vv = 1; return; }
  if (zeta > 1.0001) {
    const za = -omega * zeta;
    const zb = omega * Math.sqrt(zeta * zeta - 1);
    const z1 = za - zb;
    const z2 = za + zb;
    const e1 = Math.exp(z1 * dt) / (2 * zb);
    const e2 = Math.exp(z2 * dt) / (2 * zb);
    C.pp = e1 * z2 - z2 * e2 + Math.exp(z2 * dt);
    C.pv = -e1 + e2;
    C.vp = (z1 * e1 - z2 * e2 + Math.exp(z2 * dt)) * z2;
    C.vv = -z1 * e1 + z2 * e2;
  } else if (zeta < 0.9999) {
    const oz = omega * zeta;
    const alpha = omega * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-oz * dt);
    const cos = Math.cos(alpha * dt);
    const sin = Math.sin(alpha * dt);
    const eSin = e * sin;
    const eCos = e * cos;
    const eOzSinA = eSin * oz / alpha;
    C.pp = eCos + eOzSinA;
    C.pv = eSin / alpha;
    C.vp = -eSin * alpha - oz * eOzSinA;
    C.vv = eCos - eOzSinA;
  } else {
    const e = Math.exp(-omega * dt);
    const te = dt * e;
    const tef = te * omega;
    C.pp = tef + e;
    C.pv = te;
    C.vp = -omega * tef;
    C.vv = -tef + e;
  }
}

/** A scalar that chases its target like a mass on a spring. */
export class Spring {
  value: number;
  target: number;
  velocity = 0;

  /**
   * @param stiffness  how hard it pulls (120 feels like a wobbly prop, 600 like a snappy one)
   * @param dampingRatio  1 settles without bouncing, below 1 overshoots, above 1 is sluggish
   */
  constructor(value = 0, public stiffness = 160, public dampingRatio = 0.8) {
    this.value = value;
    this.target = value;
  }

  set(target: number) { this.target = target; return this; }
  /** Snap to a value with no motion. */
  jump(value: number) { this.value = this.target = value; this.velocity = 0; return this; }

  step(dt: number) {
    springCoefficients(this.stiffness, this.dampingRatio, dt);
    const x = this.value - this.target;
    const v = this.velocity;
    this.value = x * C.pp + v * C.pv + this.target;
    this.velocity = x * C.vp + v * C.vv;
    return this.value;
  }

  get settled() { return Math.abs(this.value - this.target) < 1e-4 && Math.abs(this.velocity) < 1e-3; }
}

/** A Vector3 on a spring: the same thing, three components at once. */
export class Spring3 {
  readonly value = new THREE.Vector3();
  readonly target = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();

  constructor(value?: THREE.Vector3, public stiffness = 160, public dampingRatio = 0.8) {
    if (value) { this.value.copy(value); this.target.copy(value); }
  }

  set(target: THREE.Vector3) { this.target.copy(target); return this; }
  jump(value: THREE.Vector3) { this.value.copy(value); this.target.copy(value); this.velocity.set(0, 0, 0); return this; }

  step(dt: number) {
    springCoefficients(this.stiffness, this.dampingRatio, dt);
    const p = this.value, v = this.velocity, t = this.target;
    const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
    p.x = dx * C.pp + v.x * C.pv + t.x;
    p.y = dy * C.pp + v.y * C.pv + t.y;
    p.z = dz * C.pp + v.z * C.pv + t.z;
    v.x = dx * C.vp + v.x * C.vv;
    v.y = dy * C.vp + v.y * C.vv;
    v.z = dz * C.vp + v.z * C.vv;
    return p;
  }

  get settled() { return this.value.distanceToSquared(this.target) < 1e-8 && this.velocity.lengthSq() < 1e-6; }
}

// ---- tweens --------------------------------------------------------------------------------

interface Task {
  t: number;
  dur: number;
  ease: Ease;
  onUpdate: (k: number) => void;
  resolve: () => void;
  live: boolean;
}

/** An effect that owns a prop while it runs (a second one on the same prop replaces it). */
interface Claim { task: Task; restore: () => void }

class Motion {
  private readonly tasks: Task[] = [];
  private readonly claims = new Map<THREE.Object3D, Claim>();

  /** Kitchen calls this once per frame; every tween advances here. */
  update(dt: number) {
    const n = this.tasks.length; // tasks started by a callback this frame wait until the next
    for (let i = n - 1; i >= 0; i--) {
      const task = this.tasks[i];
      if (task.live) {
        task.t += dt;
        const k = task.dur > 0 ? Math.min(1, task.t / task.dur) : 1;
        task.onUpdate(task.ease(k));
        if (k >= 1) task.live = false;
      }
      if (!task.live) {
        this.tasks.splice(i, 1);
        task.resolve();
      }
    }
  }

  /** Run onUpdate(k) with k eased 0..1 over dur seconds; resolves on the frame it reaches 1. */
  tween(dur: number, ease: Ease, onUpdate: (k: number) => void): Promise<void> {
    return new Promise((resolve) => { this.start(dur, ease, onUpdate, resolve); });
  }

  delay(s: number): Promise<void> {
    return this.tween(s, linear, () => {});
  }

  /** Stop every effect on a prop and put it back the way the effect found it. */
  release(obj: THREE.Object3D) {
    const c = this.claims.get(obj);
    if (!c) return;
    this.claims.delete(obj);
    c.task.live = false; // resolved and removed on the next update
    c.restore();
  }

  private start(dur: number, ease: Ease, onUpdate: (k: number) => void, resolve: () => void) {
    const task: Task = { t: 0, dur, ease, onUpdate, resolve, live: true };
    this.tasks.push(task);
    return task;
  }

  /** A tween that owns obj; starting another claimed effect on obj first restores it. */
  private claimed(obj: THREE.Object3D, dur: number, ease: Ease, onUpdate: (k: number) => void, restore: () => void): Promise<void> {
    this.release(obj);
    return new Promise((resolve) => {
      const task = this.start(dur, ease, onUpdate, () => {
        if (this.claims.get(obj)?.task === task) this.claims.delete(obj);
        resolve();
      });
      this.claims.set(obj, { task, restore });
    });
  }

  // ---- the moves ------------------------------------------------------------------------

  /** Scale 0 -> 1 with a bounce, dropping the last centimetre into place. Makes obj visible. */
  popIn(obj: THREE.Object3D, dur = 0.28): Promise<void> {
    this.release(obj); // read the base transform, not a half-finished effect
    const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z;
    const y = obj.position.y;
    obj.visible = true;
    obj.scale.setScalar(0.001);
    return this.claimed(obj, dur, easeOutBack, (k) => {
      const s = Math.max(0.001, k);
      obj.scale.set(sx * s, sy * s, sz * s);
      obj.position.y = y + 0.01 * (1 - clamp01(k));
    }, () => { obj.scale.set(sx, sy, sz); obj.position.y = y; });
  }

  /** A little swell, then shrink to nothing. Resolves before the caller removes obj. */
  popOut(obj: THREE.Object3D, dur = 0.2): Promise<void> {
    this.release(obj); // read the base transform, not a half-finished effect
    const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z;
    return this.claimed(obj, dur, easeInBack, (k) => {
      const s = Math.max(0.001, 1 - k);
      obj.scale.set(sx * s, sy * s, sz * s);
    }, () => { obj.scale.set(sx, sy, sz); });
  }

  /** Landed-on-the-counter squash: y 1-amt -> 1+amt/2 -> 1, x/z the other way. */
  squash(obj: THREE.Object3D, amt = 0.15, dur = 0.25): Promise<void> {
    this.release(obj); // read the base transform, not a half-finished effect
    const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z;
    return this.claimed(obj, dur, linear, (k) => {
      // flat on impact, rebound past rest at 45% of the way, then settle
      const y = k < 0.45 ? (1 - amt) + (1.5 * amt) * easeInOutCubic(k / 0.45) : (1 + amt / 2) - (amt / 2) * easeOutCubic((k - 0.45) / 0.55);
      const xz = 1 + (1 - y) * 0.5;
      obj.scale.set(sx * xz, sy * y, sz * xz);
    }, () => { obj.scale.set(sx, sy, sz); });
  }

  /** Carry obj to a point along an arc that rises `height` at its middle. */
  arcTo(obj: THREE.Object3D, to: THREE.Vector3, dur: number, height = 0.05): Promise<void> {
    const x0 = obj.position.x, y0 = obj.position.y, z0 = obj.position.z;
    const x1 = to.x, y1 = to.y, z1 = to.z;
    return this.tween(dur, easeInOutCubic, (k) => {
      obj.position.set(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k + height * 4 * k * (1 - k), z0 + (z1 - z0) * k);
    });
  }

  /** The Nudge: a damped side-to-side shake with a quick swell. Nothing else happens. */
  wiggle(obj: THREE.Object3D, dur = 0.4): Promise<void> {
    this.release(obj); // read the base transform, not a half-finished effect
    const rz = obj.rotation.z;
    const sx = obj.scale.x, sy = obj.scale.y, sz = obj.scale.z;
    return this.claimed(obj, dur, linear, (k) => {
      const fade = 1 - k;
      obj.rotation.z = rz + 0.12 * Math.sin(k * Math.PI * 5) * fade; // 2.5 shakes, dying out
      const s = 1 + 0.06 * Math.sin(Math.min(1, k * 3) * Math.PI) * fade;
      obj.scale.set(sx * s, sy * s, sz * s);
    }, () => { obj.rotation.z = rz; obj.scale.set(sx, sy, sz); });
  }
}

/** The one sequencer; Kitchen drives it. */
export const motion = new Motion();

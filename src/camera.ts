// The camera rides a rail along the counter with three fixed Stations. A move between
// Stations is a timeline (ease in and out, 0.7 s for one hop) that starts from wherever the
// camera is and however fast a swipe left it going, then hands the last 2 mm to a critically
// damped spring. `settled` only reads true once that motion really is over.
import * as THREE from 'three';
import { easeInOutCubic } from './motion';
import { sound } from './sound';
import type { SwipeTarget } from './input';

export type StationId = 'fridge' | 'counter' | 'stove';
export const STATION_X: Record<StationId, number> = { fridge: -0.95, counter: 0, stove: 0.95 };
const ORDER: StationId[] = ['fridge', 'counter', 'stove'];
const HOP = STATION_X.counter - STATION_X.fridge;

/**
 * Where the camera stands and what it looks at, relative to the rail's x. A Step's focus may
 * also narrow the field of view (degrees), to frame a close-up from further back.
 */
export interface Pose { y: number; z: number; lookY: number; lookZ: number; fov?: number }

const PX_TO_M = 0.0022;    // a swipe moves the rail this far per CSS pixel
const END_GIVE = 0.12;     // how far past the end Stations a swipe can pull, against a rubber band
const LOCKED_GIVE = 0.06;  // the same while the rail is locked: a tug, never a turn
const OVERSHOOT = 0.002;   // the timeline aims 2 mm past the Station; the spring brings it back
const SETTLE_OMEGA = 20;   // critically damped: those 2 mm are under 0.5 mm 0.14 s after the timeline ends
const MAX_V0 = 1.5;        // m/s of swipe momentum fed into a timeline, at most
const SWOOSH_PER_PX = 0.0002; // swoosh gain per px/s of swipe (a brisk 1500 px/s flick is the 0.3 cap; by ear)
const SWOOSH_MAX = 0.3;

// Tuned by eye. Portrait: the bowl sits in the middle of the screen with the front slot
// below it, so the action fills the phone instead of crowding the header. Landscape: further
// back and higher, so the hat has ~100 px of headroom under the top edge. The Stove stands
// higher and looks up, so the oven door sits at the centre of the screen with the pan still
// in front of it; the Fridge looks a little higher, at the Shelf.
const PORTRAIT: Record<StationId, Pose> = {
  counter: { y: 0.52, z: 0.46, lookY: 0.075, lookZ: -0.02 },
  fridge: { y: 0.56, z: 0.6, lookY: 0.17, lookZ: -0.02 },
  stove: { y: 0.62, z: 0.5, lookY: 0.1, lookZ: -0.03 },
};
const LANDSCAPE: Record<StationId, Pose> = {
  counter: { y: 0.56, z: 0.66, lookY: 0.02, lookZ: -0.04 },
  fridge: { y: 0.56, z: 0.66, lookY: 0.12, lookZ: -0.04 },
  stove: { y: 0.76, z: 0.74, lookY: 0.1, lookZ: -0.04 },
};
const FOV = { portrait: 62, tablet: 52, landscape: 42 };

export class Rail implements SwipeTarget {
  current: StationId = 'counter';
  x = 0;
  /** A Step's own view (BakeStep leans into the oven window); null is the Station's pose. */
  focus: Pose | null = null;
  /** Game locks the rail while a recipe runs and while the cat eats: a swipe then only tugs the view, and letting go brings it back. */
  locked = false;
  /** Called when a locked swipe is let go, so Game can Nudge the Step's target and re-show the hint. */
  onLockedRelease: (() => void) | null = null;
  /** Wide screens see less depth, so the camera sits further back and lower. */
  landscape = false;
  readonly listeners = new Set<(id: StationId) => void>();

  private target = 0;
  // The timeline: from x0, carrying v0 of swipe momentum, to target (plus the overshoot) over dur seconds.
  private t = Infinity;
  private dur = 0.7;
  private x0 = 0;
  private v0 = 0;
  private overshoot = 0;
  // What is left after the timeline, settling on the spring.
  private residual = 0;
  private residualV = 0;
  private velocity = 0;
  // A swipe in progress.
  private dragging = false;
  private dragBase = 0;
  private dragRaw = 0;
  private readonly pose: Pose = { ...PORTRAIT.counter };
  private poseLag = 0;
  /** How far the field of view has blended from the Station's toward a focus's own (0..1). */
  private fovMix = 0;
  private focusFov = 0;
  /** A Station change is under way: the view lands with a soft knock once it settles. */
  private arriving = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.apply();
  }

  goTo(id: StationId) {
    if (this.current !== id) { this.current = id; this.turned(SWOOSH_MAX * 0.6); for (const l of this.listeners) l(id); }
    this.travel(STATION_X[id], 0);
  }

  /** The view turns to another Station: air past the ear, louder for a quicker swipe. */
  private turned(gain: number) {
    sound.play('swoosh', { gain: Math.min(SWOOSH_MAX, gain) });
    this.arriving = true;
  }

  /** The move is over: the timeline ran out, the spring is still, and the view has caught up. */
  get settled() {
    return !this.dragging && this.t >= this.dur && Math.abs(this.residual) < 0.0005 && Math.abs(this.velocity) < 0.01 && this.poseLag < 0.002;
  }

  /** On a timeline or under a finger: a move this frame is deliberate, not a jump. */
  get moving() { return this.dragging || this.t < this.dur; }

  drag(dx: number) {
    if (!this.dragging) {
      // A finger takes over from any timeline; the move resumes from wherever it lets go.
      this.dragging = true;
      this.dragBase = this.x;
      this.dragRaw = 0;
      this.t = this.dur;
      this.residual = 0;
      this.residualV = 0;
    }
    this.dragRaw -= dx * PX_TO_M;
    if (this.locked) {
      this.x = this.dragBase + LOCKED_GIVE * Math.tanh(this.dragRaw / LOCKED_GIVE);
      return;
    }
    const raw = this.dragBase + this.dragRaw;
    const lo = STATION_X.fridge, hi = STATION_X.stove;
    this.x = raw < lo ? lo - END_GIVE * Math.tanh((lo - raw) / END_GIVE)
      : raw > hi ? hi + END_GIVE * Math.tanh((raw - hi) / END_GIVE)
      : raw;
  }

  release(vx: number) {
    if (!this.dragging) return;
    this.dragging = false;
    if (this.locked) {
      this.travel(STATION_X[this.current], 0);
      this.onLockedRelease?.();
      return;
    }
    const v = THREE.MathUtils.clamp(-vx * PX_TO_M, -MAX_V0, MAX_V0);
    // Where the swipe would coast to in the next quarter second decides the Station: a short
    // flick still turns, a long slow drag goes where it was left, and no swipe skips a Station.
    const guess = this.x + v * 0.25;
    let best: StationId = 'counter';
    let bestD = Infinity;
    for (const id of ORDER) {
      const d = Math.abs(STATION_X[id] - guess);
      if (d < bestD) { bestD = d; best = id; }
    }
    if (this.current !== best) {
      this.current = best;
      this.turned(THREE.MathUtils.clamp(Math.abs(vx) * SWOOSH_PER_PX, 0.08, SWOOSH_MAX));
      for (const l of this.listeners) l(best);
    }
    this.travel(STATION_X[best], v);
  }

  update(dt: number) {
    const before = this.x;
    if (!this.dragging) {
      if (this.t < this.dur) {
        this.t = Math.min(this.dur, this.t + dt);
        const k = easeInOutCubic(this.t / this.dur);
        // Momentum from the swipe: starts at v0 and dies out by the end of the timeline.
        const kick = this.v0 * this.t * Math.pow(1 - this.t / this.dur, 2);
        this.x = this.x0 + (this.target + this.overshoot - this.x0) * k + kick;
        if (this.t >= this.dur) { this.residual = this.x - this.target; this.residualV = 0; }
      } else if (this.residual !== 0 || this.residualV !== 0) {
        // Closed-form critically damped spring, exact for any dt.
        const w = SETTLE_OMEGA;
        const e = Math.exp(-w * dt);
        const r = this.residual, v = this.residualV;
        this.residual = (r + (v + w * r) * dt) * e;
        this.residualV = (v - w * (v + w * r) * dt) * e;
        if (Math.abs(this.residual) < 1e-5 && Math.abs(this.residualV) < 1e-4) this.residual = this.residualV = 0;
        this.x = this.target + this.residual;
      }
    }
    this.velocity = dt > 0 ? (this.x - before) / dt : 0;
    this.apply(dt);
    if (this.arriving && this.settled) this.arriving = false; // the view lands silently (no thud on every Station)
  }

  private travel(target: number, v0: number) {
    const dist = target - this.x;
    if (target === this.target && (this.t < this.dur || Math.abs(dist) < 0.001)) return; // already on the way, or there
    this.target = target;
    this.x0 = this.x;
    this.v0 = THREE.MathUtils.clamp(v0, -MAX_V0, MAX_V0);
    this.overshoot = OVERSHOOT * Math.sign(dist);
    // 0.7 s for one hop; a short return is quicker, the double hop a little longer.
    this.dur = THREE.MathUtils.clamp(0.7 * Math.sqrt(Math.abs(dist) / HOP), 0.3, 1);
    this.t = 0;
    this.residual = 0;
    this.residualV = 0;
  }

  /** The Station pose at this x: between two Stations the poses cross-fade with the same ease as the move. */
  private stationPose(x: number, out: Pose) {
    const poses = this.landscape ? LANDSCAPE : PORTRAIT;
    const c = THREE.MathUtils.clamp(x, STATION_X.fridge, STATION_X.stove);
    let a = ORDER[0], b = ORDER[0];
    for (let i = 1; i < ORDER.length; i++) if (c >= STATION_X[ORDER[i - 1]]) { a = ORDER[i - 1]; b = ORDER[i]; }
    const k = easeInOutCubic((c - STATION_X[a]) / (STATION_X[b] - STATION_X[a]));
    const pa = poses[a], pb = poses[b];
    out.y = pa.y + (pb.y - pa.y) * k;
    out.z = pa.z + (pb.z - pa.z) * k;
    out.lookY = pa.lookY + (pb.lookY - pa.lookY) * k;
    out.lookZ = pa.lookZ + (pb.lookZ - pa.lookZ) * k;
    return out;
  }

  private readonly want: Pose = { ...PORTRAIT.counter };

  /** Blend the view toward the Station pose (or a Step's focus) and point the camera. dt = 0 snaps (a resize). */
  private apply(dt = 0) {
    const want = this.focus ?? this.stationPose(this.x, this.want);
    // A Step's focus leans in gently; the Station pose keeps up with the rail so a settled rail is a settled view.
    const k = dt > 0 ? 1 - Math.exp(-(this.focus ? 4 : 12) * dt) : 1;
    const p = this.pose;
    p.y += (want.y - p.y) * k;
    p.z += (want.z - p.z) * k;
    p.lookY += (want.lookY - p.lookY) * k;
    p.lookZ += (want.lookZ - p.lookZ) * k;
    const aspect = this.camera.aspect;
    const base = this.landscape ? FOV.landscape : aspect < 0.75 ? FOV.portrait : FOV.tablet;
    // A focus with its own field of view zooms with the same lean as the pose; letting the
    // focus go zooms back out to the Station's.
    if (this.focus?.fov) this.focusFov = this.focus.fov;
    const mixWant = this.focus?.fov ? 1 : 0;
    this.fovMix += (mixWant - this.fovMix) * k;
    if (Math.abs(mixWant - this.fovMix) < 1e-4) this.fovMix = mixWant;
    const fov = this.fovMix > 0 ? base + (this.focusFov - base) * this.fovMix : base;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.poseLag = Math.max(Math.abs(want.y - p.y), Math.abs(want.z - p.z), Math.abs(want.lookY - p.lookY), Math.abs(want.lookZ - p.lookZ), Math.abs(mixWant - this.fovMix) * 0.1);
    this.camera.position.set(this.x, p.y, p.z);
    this.camera.lookAt(this.x, p.lookY, p.lookZ);
  }
}

// The four Gestures, as reusable pieces: Hold and Stir meters, and Carry for Drag.
import * as THREE from 'three';
import type { Kitchen } from './kitchen';
import type { PointerHandler } from './input';
import type { Result } from './steps/step';

/** A ring that fills while you hold or stir; where you stop decides the Result. */
export class HoldMeter {
  progress = 0;
  constructor(public duration: number, public sweet: [number, number]) {}

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
  private lastAngle: number | null = null;

  update(x: number, y: number, cx: number, cy: number, dt: number) {
    const a = Math.atan2(y - cy, x - cx);
    if (this.lastAngle !== null) {
      let d = a - this.lastAngle;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      this.turns += Math.abs(d) / (Math.PI * 2);
      this.speed += (Math.abs(d) / Math.max(dt, 1e-3) - this.speed) * 0.3;
    }
    this.lastAngle = a;
  }

  lift() {
    this.lastAngle = null;
    this.speed = 0;
  }

  decay(dt: number) { this.speed *= Math.exp(-6 * dt); }
}

export interface CarryItem {
  obj: THREE.Object3D;
  home: THREE.Vector3;
  placed: boolean;
}

export interface CarryOptions {
  holdY: number;
  grabPx?: number;
  onGrab?(item: CarryItem): void;
  onMove?(item: CarryItem, pos: THREE.Vector3): void;
  /** Return true if the item was placed (the callback is responsible for where it sits now). */
  onDrop(item: CarryItem, pos: THREE.Vector3): boolean;
}

/** Drag: pick a thing up, it follows the finger on a plane and leans with its motion. */
export class Carry implements PointerHandler {
  held: CarryItem | null = null;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  private readonly prev = new THREE.Vector3();
  private pointer = { x: 0, y: 0 };
  private returning: { item: CarryItem; from: THREE.Vector3; t: number }[] = [];

  constructor(private readonly k: Kitchen, readonly items: CarryItem[], private readonly o: CarryOptions) {}

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
    this.held = best;
    this.pointer = { x, y };
    this.pos.copy(best.obj.position);
    this.prev.copy(this.pos);
    this.o.onGrab?.(best);
    return true;
  }

  move(x: number, y: number) { this.pointer = { x, y }; }

  up() {
    const it = this.held;
    if (!it) return;
    this.held = null;
    if (this.o.onDrop(it, this.pos.clone())) { it.placed = true; return; }
    this.returning.push({ item: it, from: it.obj.position.clone(), t: 0 });
  }

  update(dt: number, t: number) {
    const it = this.held;
    if (it) {
      const target = this.k.fingerAt(this.pointer.x, this.pointer.y, this.o.holdY);
      if (target) this.pos.lerp(target, 1 - Math.exp(-20 * dt));
      this.vel.subVectors(this.pos, this.prev).divideScalar(Math.max(dt, 1e-3));
      this.prev.copy(this.pos);
      it.obj.position.copy(this.pos);
      it.obj.rotation.set(
        THREE.MathUtils.clamp(this.vel.z * 0.6, -0.4, 0.4) + Math.sin(t * 9) * 0.02,
        0,
        THREE.MathUtils.clamp(-this.vel.x * 0.6, -0.4, 0.4) + Math.cos(t * 7) * 0.02,
      );
      this.o.onMove?.(it, this.pos);
    }
    for (const r of this.returning) {
      r.t = Math.min(1, r.t + dt / 0.35);
      const e = 1 - Math.pow(1 - r.t, 3);
      r.item.obj.position.lerpVectors(r.from, r.item.home, e);
      r.item.obj.position.y += Math.sin(e * Math.PI) * 0.03;
      r.item.obj.rotation.set(0, 0, 0);
    }
    this.returning = this.returning.filter((r) => r.t < 1);
  }
}

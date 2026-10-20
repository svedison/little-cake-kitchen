// The camera rides a rail along the counter with three fixed Stations.
import * as THREE from 'three';
import type { SwipeTarget } from './input';

export type StationId = 'fridge' | 'counter' | 'stove';
export const STATION_X: Record<StationId, number> = { fridge: -0.95, counter: 0, stove: 0.95 };
const ORDER: StationId[] = ['fridge', 'counter', 'stove'];

export class Rail implements SwipeTarget {
  current: StationId = 'counter';
  x = 0;
  private target = 0;
  private dragging = false;
  readonly listeners = new Set<(id: StationId) => void>();

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.apply();
  }

  goTo(id: StationId) {
    if (this.current !== id) for (const l of this.listeners) l(id);
    this.current = id;
    this.target = STATION_X[id];
  }

  get settled() { return !this.dragging && Math.abs(this.x - this.target) < 0.004; }

  drag(dx: number) {
    this.dragging = true;
    this.x = THREE.MathUtils.clamp(this.x - dx * 0.0022, STATION_X.fridge - 0.12, STATION_X.stove + 0.12);
  }

  release(vx: number) {
    this.dragging = false;
    const guess = this.x - vx * 0.0022 * 0.18;
    let best: StationId = 'counter';
    let bestD = Infinity;
    for (const id of ORDER) {
      const d = Math.abs(STATION_X[id] - guess);
      if (d < bestD) { bestD = d; best = id; }
    }
    this.goTo(best);
  }

  update(dt: number) {
    if (!this.dragging) this.x += (this.target - this.x) * (1 - Math.exp(-6 * dt));
    this.apply();
  }

  /** Wide screens see less depth, so the camera sits a little further back and lower. */
  landscape = false;

  private apply() {
    if (this.landscape) {
      this.camera.position.set(this.x, 0.5, 0.56);
      this.camera.lookAt(this.x, 0.0, 0.04);
    } else {
      this.camera.position.set(this.x, 0.5, 0.42);
      this.camera.lookAt(this.x, 0.02, -0.02);
    }
  }
}

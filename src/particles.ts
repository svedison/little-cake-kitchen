// One kinematic particle pool for everything that sprinkles, splashes, puffs or rains:
// droplets, flour sift, smoke, steam, confetti. A single InstancedMesh, flat typed
// arrays, no Rapier (ADR-0002). Particles fall under gravity, lose speed to drag,
// drift with a little lateral jitter, and may land on a surface.
import * as THREE from 'three';

export type FloorMode = 'die' | 'spread' | 'rest';

/** What a landed particle looks like to onLand; reused, so copy what you keep. */
export interface Landed { x: number; y: number; z: number; vx: number; vy: number; vz: number; scale: number }

export interface PoolOpts {
  /** m/s^2 downward (positive). */
  gravity?: number;
  /** Per-second velocity decay. */
  drag?: number;
  /** Random sideways acceleration, for flutter and drift. */
  jitter?: number;
  /** Height particles land on, if any. */
  floorY?: number;
  /** die: vanish on landing; spread: flatten out over 0.3 s; rest: lie there until life runs out. */
  floor?: FloorMode;
  onLand?: (p: Landed) => void;
  /** Seconds before death over which a particle shrinks away. */
  fade?: number;
}

export interface EmitOpts {
  at: { x: number; y: number; z: number };
  count?: number;
  /** Position jitter radius (m). */
  spread?: number;
  vel?: { x: number; y: number; z: number };
  /** Uniform random added to each velocity component (m/s). */
  velJitter?: number;
  life?: number;
  /** Fraction of life randomised (0.3 = +-30%). */
  lifeJitter?: number;
  scale?: number;
  scaleJitter?: number;
  /** Random tumble speed (rad/s). */
  spin?: number;
  color?: THREE.Color | number;
}

const SPREAD_TIME = 0.3;
const DEFAULT_COLOR = new THREE.Color(0xffffff);
const landed: Landed = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, scale: 1 };

export class ParticlePool {
  readonly mesh: THREE.InstancedMesh;
  /** Live particles. */
  count = 0;
  gravity: number;
  drag: number;
  jitter: number;
  floorY: number | null;
  floor: FloorMode;
  onLand: ((p: Landed) => void) | null;
  fade: number;

  // Structure-of-arrays state; live particles are the first `count` slots.
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly size: Float32Array;
  private readonly down: Uint8Array; // 1 once landed
  private readonly color: Float32Array;
  private colorDirty = false;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, readonly max: number, opts: PoolOpts = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, DEFAULT_COLOR); // creates instanceColor
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.rot = new Float32Array(max * 3);
    this.spin = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.size = new Float32Array(max);
    this.down = new Uint8Array(max);
    this.color = new Float32Array(max * 3).fill(1);
    this.gravity = opts.gravity ?? 9.81;
    this.drag = opts.drag ?? 0;
    this.jitter = opts.jitter ?? 0;
    this.floorY = opts.floorY ?? null;
    this.floor = opts.floor ?? 'die';
    this.onLand = opts.onLand ?? null;
    this.fade = opts.fade ?? 0;
  }

  /** Spawn particles; the oldest make room when the pool is full. Returns how many spawned. */
  emit(o: EmitOpts) {
    const n = Math.max(1, Math.floor(o.count ?? 1));
    const spread = o.spread ?? 0;
    const vj = o.velJitter ?? 0;
    const life = o.life ?? 1;
    const lj = o.lifeJitter ?? 0;
    const scale = o.scale ?? 1;
    const sj = o.scaleJitter ?? 0;
    const spin = o.spin ?? 0;
    if (o.color !== undefined) this.c.set(o.color); else this.c.copy(DEFAULT_COLOR);
    for (let k = 0; k < n; k++) {
      let i = this.count;
      if (i >= this.max) { i = this.oldest(); } else this.count++;
      const i3 = i * 3;
      this.pos[i3] = o.at.x + (Math.random() - 0.5) * 2 * spread;
      this.pos[i3 + 1] = o.at.y + (Math.random() - 0.5) * 2 * spread;
      this.pos[i3 + 2] = o.at.z + (Math.random() - 0.5) * 2 * spread;
      this.vel[i3] = (o.vel?.x ?? 0) + (Math.random() - 0.5) * 2 * vj;
      this.vel[i3 + 1] = (o.vel?.y ?? 0) + (Math.random() - 0.5) * 2 * vj;
      this.vel[i3 + 2] = (o.vel?.z ?? 0) + (Math.random() - 0.5) * 2 * vj;
      this.rot[i3] = Math.random() * 6.283;
      this.rot[i3 + 1] = Math.random() * 6.283;
      this.rot[i3 + 2] = Math.random() * 6.283;
      this.spin[i3] = (Math.random() - 0.5) * 2 * spin;
      this.spin[i3 + 1] = (Math.random() - 0.5) * 2 * spin;
      this.spin[i3 + 2] = (Math.random() - 0.5) * 2 * spin;
      this.life[i] = life * (1 + (Math.random() - 0.5) * 2 * lj);
      this.age[i] = 0;
      this.size[i] = scale * (1 + (Math.random() - 0.5) * 2 * sj);
      this.down[i] = 0;
      this.color[i3] = this.c.r; this.color[i3 + 1] = this.c.g; this.color[i3 + 2] = this.c.b;
    }
    this.colorDirty = true;
    this.mesh.visible = true;
    return n;
  }

  update(dt: number) {
    if (this.count === 0) { this.mesh.visible = false; return; }
    const pos = this.pos, vel = this.vel, rot = this.rot, spin = this.spin;
    const decay = this.drag > 0 ? Math.exp(-this.drag * dt) : 1;
    const g = this.gravity * dt;
    const j = this.jitter * dt;
    const floorY = this.floorY;
    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); i--; continue; }
      if (!this.down[i]) {
        vel[i3 + 1] -= g;
        if (j > 0) { vel[i3] += (Math.random() - 0.5) * 2 * j; vel[i3 + 2] += (Math.random() - 0.5) * 2 * j; }
        vel[i3] *= decay; vel[i3 + 1] *= decay; vel[i3 + 2] *= decay;
        const wasAbove = floorY !== null && pos[i3 + 1] >= floorY;
        pos[i3] += vel[i3] * dt;
        pos[i3 + 1] += vel[i3 + 1] * dt;
        pos[i3 + 2] += vel[i3 + 2] * dt;
        rot[i3] += spin[i3] * dt; rot[i3 + 1] += spin[i3 + 1] * dt; rot[i3 + 2] += spin[i3 + 2] * dt;
        if (floorY !== null && wasAbove && pos[i3 + 1] < floorY && vel[i3 + 1] < 0) {
          pos[i3 + 1] = floorY;
          if (this.onLand) {
            landed.x = pos[i3]; landed.y = floorY; landed.z = pos[i3 + 2];
            landed.vx = vel[i3]; landed.vy = vel[i3 + 1]; landed.vz = vel[i3 + 2];
            landed.scale = this.size[i];
            this.onLand(landed);
          }
          if (this.floor === 'die') { this.kill(i); i--; continue; }
          this.down[i] = 1;
          vel[i3] = vel[i3 + 1] = vel[i3 + 2] = 0;
          spin[i3] = spin[i3 + 1] = spin[i3 + 2] = 0;
          if (this.floor === 'spread') {
            // lie flat and puddle out for a moment, then go
            this.age[i] = 0;
            this.life[i] = SPREAD_TIME;
            rot[i3] = -Math.PI / 2; rot[i3 + 1] = 0; rot[i3 + 2] = Math.random() * 6.283;
          }
        }
      }
      this.writeMatrix(i);
    }
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty) { this.flushColors(); }
    this.mesh.visible = this.count > 0;
  }

  /** Remove every particle at once. */
  clear() {
    this.count = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  dispose(scene?: THREE.Scene) {
    scene?.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }

  private writeMatrix(i: number) {
    const i3 = i * 3;
    let s = this.size[i];
    const left = this.life[i] - this.age[i];
    if (this.down[i] && this.floor === 'spread') {
      const k = this.age[i] / SPREAD_TIME; // 0..1 over the puddle
      this.s.set(s * (1 + 0.8 * k), s * 0.25 * (1 - k) + 0.001, s * (1 + 0.8 * k));
    } else {
      if (this.fade > 0 && left < this.fade) s *= Math.max(0.001, left / this.fade);
      this.s.set(s, s, s);
    }
    this.p.set(this.pos[i3], this.pos[i3 + 1], this.pos[i3 + 2]);
    this.e.set(this.rot[i3], this.rot[i3 + 1], this.rot[i3 + 2]);
    this.q.setFromEuler(this.e);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
  }

  /** Swap the last live particle into slot i. */
  private kill(i: number) {
    const last = --this.count;
    if (i === last) return;
    const a = i * 3, b = last * 3;
    for (let k = 0; k < 3; k++) {
      this.pos[a + k] = this.pos[b + k];
      this.vel[a + k] = this.vel[b + k];
      this.rot[a + k] = this.rot[b + k];
      this.spin[a + k] = this.spin[b + k];
      this.color[a + k] = this.color[b + k];
    }
    this.life[i] = this.life[last];
    this.age[i] = this.age[last];
    this.size[i] = this.size[last];
    this.down[i] = this.down[last];
    this.colorDirty = true;
  }

  /** Slot of the particle nearest death, recycled when the pool is full. */
  private oldest() {
    let best = 0, bestLeft = Infinity;
    for (let i = 0; i < this.count; i++) {
      const left = this.life[i] - this.age[i];
      if (left < bestLeft) { bestLeft = left; best = i; }
    }
    return best;
  }

  private flushColors() {
    const attr = this.mesh.instanceColor!;
    (attr.array as Float32Array).set(this.color.subarray(0, this.count * 3));
    attr.needsUpdate = true;
    this.colorDirty = false;
  }
}

// The little drops around a pour: beads that shake loose from the bottom of the stream,
// a splash where it lands, and the last drips off the lip when the pour stops. One small
// ParticlePool of spheres; every drop dies when it falls back into the surface and leaves
// a tiny ripple there (ADR-0002: drops, not a fluid).
import * as THREE from 'three';
import { ParticlePool } from './particles';
import type { Stream } from './stream';

const MAX = 40;
const R_MIN = 0.0015, R_MAX = 0.003; // m

interface Drip { at: number; from: () => THREE.Vector3 }

export class Droplets {
  readonly pool: ParticlePool;
  private beadAcc = 0;
  private splashT = 0;
  private wasLanded = false;
  private clock = 0;
  private drips: Drip[] = [];
  private color = new THREE.Color(0xffffff);
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  /** onLand gets each drop as it falls back into the surface, for a tiny ripple. */
  constructor(scene: THREE.Scene, onLand: (x: number, y: number, z: number, size: number) => void) {
    this.pool = new ParticlePool(
      new THREE.SphereGeometry(1, 8, 6),
      new THREE.MeshStandardMaterial({ roughness: 0.25 }),
      MAX,
      { gravity: 9.81, floor: 'die', onLand: (d) => onLand(d.x, d.y, d.z, d.scale) },
    );
    this.pool.mesh.castShadow = false;
    scene.add(this.pool.mesh);
  }

  get count() { return this.pool.count; }

  setColor(hex: number) { this.color.set(hex); }

  /**
   * Per frame while a stream exists. Beads leave the lower third of the stream at a rate
   * that grows with the flow and with how fast the lip is moving; a fresh landing splashes
   * 3-6 drops, a steady one keeps throwing one or two up.
   */
  update(dt: number, stream: Stream, surfaceY: number, lipSpeed: number) {
    this.clock += dt;
    this.pool.floorY = surfaceY;
    if (stream.active && stream.fallTime > 0) {
      // Beads off the stream (tuned by eye: a few a second, a shower when you wave the jug).
      this.beadAcc += dt * stream.flow * (12 + 90 * lipSpeed);
      while (this.beadAcc >= 1) {
        this.beadAcc -= 1;
        const age = stream.fallTime * (0.66 + 0.3 * Math.random());
        stream.pointAt(age, stream.fallTime, this.clock, this.p);
        stream.velocityAt(age, this.v);
        this.emit(this.p, this.v.x * 0.9 + (Math.random() - 0.5) * 0.12, this.v.y * 0.9, this.v.z * 0.9 + (Math.random() - 0.5) * 0.12);
      }
      const landed = stream.landedFraction > 0.5;
      if (landed && !this.wasLanded) this.splash(stream.landing, 3 + Math.floor(Math.random() * 4));
      if (landed) {
        this.splashT -= dt;
        if (this.splashT <= 0) { this.splashT = 0.05 + Math.random() * 0.05; this.splash(stream.landing, 2 + Math.round(Math.random() * 2 * stream.landingFlow)); }
      }
      this.wasLanded = landed;
    } else this.wasLanded = false;

    for (let i = this.drips.length - 1; i >= 0; i--) {
      if (this.clock < this.drips[i].at) continue;
      const at = this.drips[i].from();
      this.drips.splice(i, 1);
      this.emit(at, 0, -0.05, 0, 1.15);
    }
    this.pool.update(dt);
  }

  /** A crown of drops thrown up and out from a landing point (0.2-0.4 m/s up). */
  splash(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const out = 0.08 + Math.random() * 0.12;
      this.p.set(at.x + Math.cos(a) * 0.004, at.y + 0.003, at.z + Math.sin(a) * 0.004);
      this.emit(this.p, Math.cos(a) * out, 0.2 + Math.random() * 0.2, Math.sin(a) * out);
    }
  }

  /** A released thread snapping: 5-7 drops strung along what was still falling, keeping its speed. */
  breakUp(stream: Stream, fromAge: number, toAge: number) {
    const n = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const age = fromAge + (toAge - fromAge) * ((i + 0.3 + 0.4 * Math.random()) / n);
      stream.pointAt(age, stream.fallTime, this.clock, this.p);
      stream.velocityAt(age, this.v);
      this.emit(this.p, this.v.x + (Math.random() - 0.5) * 0.04, this.v.y, this.v.z + (Math.random() - 0.5) * 0.04, 0.9 + 0.4 * (1 - i / n));
    }
  }

  /** The last 2-3 drips off the lip after the pour stops; `from` is read when each one falls. */
  drip(from: () => THREE.Vector3, n = 2 + Math.floor(Math.random() * 2)) {
    for (let i = 0; i < n; i++) this.drips.push({ at: this.clock + 0.05 + i * (0.07 + Math.random() * 0.03), from });
  }

  clear() { this.pool.clear(); this.drips = []; }

  dispose(scene: THREE.Scene) { this.pool.dispose(scene); }

  private emit(at: THREE.Vector3, vx: number, vy: number, vz: number, sizeK = 1) {
    this.pool.emit({
      at, vel: { x: vx, y: vy, z: vz },
      life: 0.6, scale: (R_MIN + Math.random() * (R_MAX - R_MIN)) * sizeK, color: this.color,
    });
  }
}

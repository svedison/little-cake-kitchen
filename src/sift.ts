// Flour sifting off a tipped cup: a soft cloud, never a stream. Tiny matte flakes leave
// the lip in a cone, flutter down under drag (flour hangs in the air), and where they
// reach the batter each one puffs out sideways for 0.3 s and is gone, while the Bowl's
// dusting grows from that point (ADR-0002: particles, not a powder simulation).
//
// Two ParticlePools: the falling flakes, and the puffs they turn into on landing.
import * as THREE from 'three';
import { ParticlePool, type Landed } from './particles';

const MAX_FALL = 150;
const MAX_PUFF = 90;
const RATE = 360;        // flakes/s at full flow (tuned by eye: ~100 in the air at once)
const CONE = 0.4;        // rad, half-angle of the cone off the lip
const SPEED = [0.3, 0.5] as const; // m/s off the lip
const PUFF_LIFE = 0.3;   // s
// m, flake radius: 2-3.6 mm across (tuned by eye: true 1-2 mm flakes are a pixel on a phone and the cloud vanishes)
const R = [0.001, 0.0018] as const;

/** A soft flake: a squashed low-poly ball, so it reads as a disc from most angles. */
function flake() {
  const g = new THREE.SphereGeometry(1, 6, 4);
  g.scale(1, 0.45, 1);
  return g;
}

export class Sift {
  /** 0..1, how hard it is sifting (input). */
  flow = 0;
  /** The lip, in world space (input). */
  readonly from = new THREE.Vector3();
  /** The lip's downhill direction, a unit vector (input). */
  readonly dir = new THREE.Vector3(1, 0, 0);
  /** Height of what it lands on (input). */
  surfaceY = 0;
  /** Flakes per second leaving the lip right now (output, drives the flour loop). */
  rate = 0;

  private readonly fall: ParticlePool;
  private readonly puff: ParticlePool;
  private acc = 0;
  private readonly axis = new THREE.Vector3();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly at = { x: 0, y: 0, z: 0 };
  private readonly vel = { x: 0, y: 0, z: 0 };

  /** onLand gets each flake as it reaches the surface (copy what you keep). */
  constructor(scene: THREE.Scene, color: number, onLand: (p: Landed) => void) {
    const mat = () => new THREE.MeshStandardMaterial({ color, roughness: 1, transparent: true, opacity: 0.85, depthWrite: false });
    // Flour floats: weak gravity and strong drag give it a slow ~0.6 m/s fall and a flutter.
    this.fall = new ParticlePool(flake(), mat(), MAX_FALL, {
      gravity: 2.6, drag: 4, jitter: 0.5, floor: 'die', fade: 0.12,
      onLand: (p) => { this.land(p); onLand(p); },
    });
    this.puff = new ParticlePool(flake(), mat(), MAX_PUFF, { gravity: 0, drag: 5, fade: PUFF_LIFE });
    for (const p of [this.fall, this.puff]) { p.mesh.castShadow = false; p.mesh.renderOrder = 2; scene.add(p.mesh); }
  }

  /** Flakes in the air plus puffs still showing. */
  get count() { return this.fall.count + this.puff.count; }

  /** Emission now as a share of full rate, 0..1 (the flour loop's level). */
  get intensity() { return this.rate / RATE; }

  /** Flakes leaving the lip per second at full flow. */
  static readonly RATE = RATE;

  update(dt: number) {
    this.fall.floorY = this.surfaceY;
    this.rate = this.flow > 0.02 ? RATE * this.flow : 0;
    if (this.rate > 0) {
      // The cone leans mostly down: flour slides off the lip and drops, it is not thrown.
      this.axis.set(this.dir.x * 0.35, -1, this.dir.z * 0.35).normalize();
      this.a.set(0, 0, 1).cross(this.axis).normalize();
      this.b.crossVectors(this.axis, this.a);
      this.acc += dt * this.rate;
      while (this.acc >= 1) {
        this.acc -= 1;
        const th = CONE * Math.sqrt(Math.random()), ph = Math.random() * Math.PI * 2;
        this.d.copy(this.axis).multiplyScalar(Math.cos(th))
          .addScaledVector(this.a, Math.sin(th) * Math.cos(ph))
          .addScaledVector(this.b, Math.sin(th) * Math.sin(ph));
        const v = SPEED[0] + Math.random() * (SPEED[1] - SPEED[0]);
        // off the whole width of the lip, not one point
        this.at.x = this.from.x + (Math.random() - 0.5) * 0.008;
        this.at.y = this.from.y - Math.random() * 0.003;
        this.at.z = this.from.z + (Math.random() - 0.5) * 0.016;
        this.vel.x = this.d.x * v; this.vel.y = this.d.y * v; this.vel.z = this.d.z * v;
        this.fall.emit({ at: this.at, vel: this.vel, life: 0.9, scale: R[0] + Math.random() * (R[1] - R[0]), spin: 8 });
      }
    } else this.acc = 0;
    this.fall.update(dt);
    this.puff.update(dt);
  }

  /** A flake reaching the batter slows and spreads sideways into a little puff, then fades. */
  private land(p: Landed) {
    const a = Math.random() * Math.PI * 2;
    const out = 0.08 + Math.random() * 0.1;
    this.at.x = p.x; this.at.y = p.y + 0.0015; this.at.z = p.z;
    this.vel.x = p.vx * 0.4 + Math.cos(a) * out;
    this.vel.y = 0.01 + Math.random() * 0.02;
    this.vel.z = p.vz * 0.4 + Math.sin(a) * out;
    this.puff.emit({ at: this.at, vel: this.vel, life: PUFF_LIFE, scale: p.scale * 2.6, spin: 3 });
  }

  clear() { this.fall.clear(); this.puff.clear(); this.acc = 0; }

  dispose(scene: THREE.Scene) { this.fall.dispose(scene); this.puff.dispose(scene); }
}

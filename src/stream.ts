// A pour: a ribbon that leaves a lip and falls like the real thing. Not a fluid, just a
// shape that follows the hand (ADR-0002), but its shape comes from a ballistic path:
//
//   p(t) = lip + v0·t + ½·g·t²      (t = how long a drop has been falling)
//
// so it leaves the lip slowly, curves, speeds up and thins (r ∝ sqrt(|v0| / |v|), which
// is what keeps the volume going through each ring constant). The flow is a head and a
// tail: on start the head runs down from the lip at fall speed; on release the tail
// leaves the lip and falls after it, so the last of the pour drops instead of vanishing.
// Where the head meets the surface (`landing`) is an output the Step reads for ripples,
// the mound and the sound. The landing lags the lip on a spring, so the ribbon bends
// when the jug moves.
//
// Two ways to aim: a free pour ('surface') falls from `from` along `dir` and lands where
// the parabola crosses `surfaceY`; an aimed pour ('to') is thrown so it lands on `to`.
import * as THREE from 'three';
import { Spring } from './motion';

const RINGS = 24;
const SIDES = 8;
const G = 9.81;
const WOBBLE = 0.002;   // m, lateral wobble at the landing end
const MIN_TAPER = 0.4;  // default thinnest a ribbon gets, relative to the lip (reads as a thread, not a line)
const START = 0.03;     // flow above which a pour is running

export class Stream {
  readonly mesh: THREE.Mesh;
  /** The lip, in world space (input). */
  readonly from = new THREE.Vector3();
  /** Aimed pours: where it should land (input). */
  readonly to = new THREE.Vector3();
  /** Free pours: the lip's downhill tangent, a unit vector (input). */
  readonly dir = new THREE.Vector3(1, 0, 0);
  /** Free pours: the height of what it lands on (input). */
  surfaceY = 0;
  mode: 'to' | 'surface' = 'to';
  /** Radius at the lip at full flow. */
  radius = 0.006;
  /** 0..1, how hard it pours (input). Rises from 0 to start a pour; back to 0 releases it. */
  flow = 0;
  /** Cross-section width:depth; batter runs as a flat ribbon (2.2), cream as a round rope (1). */
  ellipse = 1;
  /** The thinnest the thread gets as it speeds up, relative to the lip; a runny pour (cream) thins hard (0.15). */
  minTaper = MIN_TAPER;
  /**
   * Seconds after release before the falling remainder snaps into drops (output via onBreak);
   * Infinity keeps it a falling ribbon (thick batter). A thin thread breaks almost at once.
   */
  breakAfter = Infinity;
  /** Called once when a released tail snaps: `at(age)` gives points along what was still falling. */
  onBreak: ((from: number, to: number) => void) | null = null;
  /** Draw a flattened puddle where the pour lands, widening as it keeps landing. */
  foot = false;
  /** Where the stream meets the surface (output, world space). */
  readonly landing = new THREE.Vector3();
  /** 0..1, how much of the pour is reaching the surface right now (output). */
  landedFraction = 0;
  /** True from the moment flow starts until the tail has landed (output). */
  active = false;
  /** Fall time from the lip to the landing (output). */
  fallTime = 0;
  /** Ring radii at the lip and at the landing, for checks (output). */
  lipRadius = 0;
  landRadius = 0;
  /** Seconds since the tail left the lip (0 while attached). */
  tailAge = 0;
  /** How hard the pour is landing right now, 0..1: flow times landedFraction (output). */
  landingFlow = 0;
  /** Called once when the head first meets the surface and once when the tail does (for the splash sounds). */
  onLand: ((end: 'head' | 'tail', at: THREE.Vector3) => void) | null = null;

  private readonly mat: THREE.MeshPhysicalMaterial;
  private readonly footMesh: THREE.Mesh;
  private footR = 0;
  private broken = false;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private headAge = 0;
  private lastT = 0;
  private lastFlow = 0; // the flow when the tail let go; the falling remainder keeps it
  private attached = false;
  private landedT = 0;
  // the path the pour falls along: copied from the inputs while attached, frozen on release
  private readonly lip = new THREE.Vector3();
  private readonly v0 = new THREE.Vector3();
  private readonly lagX = new Spring(0, 60, 0.75);
  private readonly lagZ = new Spring(0, 60, 0.75);
  private readonly rawLanding = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly side = new THREE.Vector3();
  private readonly up2 = new THREE.Vector3();
  private readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, color: number) {
    // Glossy, like a wet pour: a clear coat catches a sheen running down the thread.
    this.mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.12 });
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(RINGS * SIDES * 3);
    this.nrm = new Float32Array(RINGS * SIDES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    const idx: number[] = [];
    for (let r = 0; r < RINGS - 1; r++) {
      for (let s = 0; s < SIDES; s++) {
        const a = r * SIDES + s, b = r * SIDES + ((s + 1) % SIDES);
        const c = a + SIDES, d = b + SIDES;
        idx.push(a, b, c, b, d, c); // counter-clockwise seen from outside
      }
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // The foot: a flattened dome of the same stuff where the thread spreads on landing.
    this.footMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.mat);
    this.footMesh.visible = false;
    scene.add(this.footMesh);
  }

  setColor(hex: number) { this.mat.color.set(hex); }

  /** Closest distance from a point to any stream vertex (Infinity when nothing is drawn). */
  distanceTo(q: THREE.Vector3) {
    if (!this.mesh.visible) return Infinity;
    let best = Infinity;
    for (let i = 0; i < this.pos.length; i += 3) {
      const d = Math.hypot(this.pos[i] - q.x, this.pos[i + 1] - q.y, this.pos[i + 2] - q.z);
      if (d < best) best = d;
    }
    return best;
  }

  /** t is the Kitchen clock; dt defaults to the time since the last call. */
  update(t: number, dt?: number) {
    dt ??= THREE.MathUtils.clamp(t - this.lastT, 0, 0.1);
    this.lastT = t;
    const flowing = this.flow > START;
    if (flowing && !this.attached) this.begin();
    else if (!flowing && this.attached) { this.attached = false; this.tailAge = 0; }
    if (this.attached) this.lastFlow = Math.max(this.flow, 0.3);
    const flow = this.attached ? this.flow : this.lastFlow;
    if (!this.active) { this.mesh.visible = this.footMesh.visible = false; this.footR = 0; this.landedFraction = this.landingFlow = 0; return; }

    if (this.attached) this.aim();
    // Fall time from the (possibly frozen) lip to the surface.
    const h = this.lip.y - this.surfaceY;
    const tf = this.fallTime = Math.max(0.02, (this.v0.y + Math.sqrt(Math.max(0, this.v0.y * this.v0.y + 2 * G * h))) / G);
    this.rawLanding.set(this.lip.x + this.v0.x * tf, this.surfaceY, this.lip.z + this.v0.z * tf);
    if (this.attached) {
      this.lagX.set(this.rawLanding.x); this.lagZ.set(this.rawLanding.z);
      this.lagX.step(dt); this.lagZ.step(dt);
    }
    this.landing.set(this.lagX.value, this.surfaceY, this.lagZ.value);

    this.headAge = Math.min(tf, this.headAge + dt);
    if (!this.attached) this.tailAge += dt;
    if (this.tailAge >= tf) {
      this.active = false; this.mesh.visible = this.footMesh.visible = false; this.footR = 0; this.landedFraction = this.landingFlow = 0;
      this.onLand?.('tail', this.landing);
      return;
    }
    const landed = this.headAge >= tf;
    if (landed && this.landedT === 0) this.onLand?.('head', this.landing);
    this.landedT = landed ? Math.min(1, this.landedT + dt / 0.05) : 0;
    this.landedFraction = this.landedT * (this.attached ? 1 : 1 - this.tailAge / tf);
    this.landingFlow = this.landedFraction * Math.min(1, flow);
    this.updateFoot(dt);
    // A thin released thread does not fall as a tube: it snaps into drops (handed to onBreak)
    // and only the landing (sound, mound, foot) plays out its remaining fall time.
    if (!this.attached && this.tailAge >= this.breakAfter) {
      if (!this.broken) { this.broken = true; this.onBreak?.(this.tailAge, this.headAge); }
      this.mesh.visible = false;
      return;
    }

    // Radius at the lip shrinks with flow (a trickle is thin), and every ring tapers by speed.
    const r0 = this.radius * (0.45 + 0.55 * Math.min(1, flow / 0.6));
    const speed0 = Math.max(0.02, this.v0.length());
    const a0 = this.tailAge, a1 = this.headAge;
    const sq = Math.sqrt(this.ellipse);
    for (let i = 0; i < RINGS; i++) {
      // More rings near the lip, where the curve bends hardest.
      const u = Math.pow(i / (RINGS - 1), 1.4);
      const age = a0 + (a1 - a0) * u;
      this.pointAt(age, tf, t, this.p, flow);
      this.v.copy(this.v0).addScaledVector(this.UP, -G * age);
      const speed = this.v.length();
      let r = r0 * Math.max(this.minTaper, Math.sqrt(speed0 / Math.max(speed, 1e-4)));
      // Once released, the whole remainder thins as it drains away (it falls apart, not as a rod).
      if (!this.attached) r *= Math.max(0.15, 1 - this.tailAge / tf);
      // Round off the free ends: the falling head is a little blob, the tail's last drop too.
      if (i === RINGS - 1 && !landed) r *= 0.25;
      else if (i === RINGS - 2 && !landed) r *= 1.25;
      if (i === 0 && !this.attached) r *= 0.25;
      else if (i === 1 && !this.attached) r *= 1.2;
      if (i === 0) this.lipRadius = r;
      if (i === RINGS - 1) this.landRadius = r;
      // A frame across the flow: `side` is horizontal, `up2` completes it.
      this.v.normalize();
      this.side.crossVectors(this.UP, this.v);
      if (this.side.lengthSq() < 1e-8) this.side.set(0, 0, 1);
      this.side.normalize();
      this.up2.crossVectors(this.v, this.side).normalize();
      // A flat ribbon twists slowly as it falls (tuned by eye).
      const twist = this.ellipse > 1 ? 0.5 * Math.sin(t * 1.3 + age * 9) : 0;
      const ra = r * sq, rb = r / sq;
      for (let s = 0; s < SIDES; s++) {
        const th = (s / SIDES) * Math.PI * 2;
        const ca = Math.cos(th), sa = Math.sin(th);
        const ex = ca * ra, ey = sa * rb;
        const cx = ex * Math.cos(twist) - ey * Math.sin(twist);
        const cy = ex * Math.sin(twist) + ey * Math.cos(twist);
        const k = (i * SIDES + s) * 3;
        this.pos[k] = this.p.x + this.side.x * cx + this.up2.x * cy;
        this.pos[k + 1] = this.p.y + this.side.y * cx + this.up2.y * cy;
        this.pos[k + 2] = this.p.z + this.side.z * cx + this.up2.z * cy;
        // normal of an ellipse: (x/a², y/b²), turned the same way
        const nx = ca / ra, ny = sa / rb;
        const tnx = nx * Math.cos(twist) - ny * Math.sin(twist);
        const tny = nx * Math.sin(twist) + ny * Math.cos(twist);
        const nl = Math.hypot(tnx, tny) || 1;
        this.nrm[k] = (this.side.x * tnx + this.up2.x * tny) / nl;
        this.nrm[k + 1] = (this.side.y * tnx + this.up2.y * tny) / nl;
        this.nrm[k + 2] = (this.side.z * tnx + this.up2.z * tny) / nl;
      }
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    this.mesh.visible = true;
  }

  /** A point `age` seconds down the stream, with the lagging bend and the wobble. */
  pointAt(age: number, tf: number, t: number, out: THREE.Vector3, flow = this.flow) {
    out.copy(this.lip).addScaledVector(this.v0, age);
    out.y -= 0.5 * G * age * age;
    const k = Math.min(1, age / tf);
    // The landing trails the lip; the ribbon bends toward it, most at the bottom.
    const bend = k * k;
    out.x += (this.landing.x - this.rawLanding.x) * bend;
    out.z += (this.landing.z - this.rawLanding.z) * bend;
    // Wobble grows down the stream, and a little bump travels down it (tuned by eye).
    const w = WOBBLE * k * Math.min(1, flow + 0.3) * (0.6 * Math.sin(t * 11 - age * 60) + 0.4 * Math.sin(t * 4.3 + 1.7));
    out.x += w * 0.8;
    out.z += w * 0.6;
    return out;
  }

  /** The stream's velocity `age` seconds down (for droplets that bead off it). */
  velocityAt(age: number, out: THREE.Vector3) {
    return out.copy(this.v0).addScaledVector(this.UP, -G * age);
  }

  /** The puddle at the landing: grows to a few thread-widths while it lands, shrinks as the tail does. */
  private updateFoot(dt: number) {
    if (!this.foot) { this.footMesh.visible = false; return; }
    const target = this.landedFraction > 0 ? this.radius * (2.2 + 1.6 * Math.min(1, this.landingFlow)) * this.landedFraction : 0;
    this.footR += (target - this.footR) * (1 - Math.exp(-(target > this.footR ? 6 : 12) * dt));
    this.footMesh.visible = this.footR > 0.0005;
    this.footMesh.position.copy(this.landing);
    this.footMesh.position.y -= 0.0008; // sits into the surface a hair
    this.footMesh.scale.set(this.footR, this.footR * 0.28, this.footR);
  }

  private begin() {
    this.broken = false;
    this.active = true;
    this.attached = true;
    this.headAge = 0;
    this.tailAge = 0;
    this.landedT = 0;
    this.aim();
    const h = this.lip.y - this.surfaceY;
    const tf = Math.max(0.02, (this.v0.y + Math.sqrt(Math.max(0, this.v0.y * this.v0.y + 2 * G * h))) / G);
    this.lagX.jump(this.lip.x + this.v0.x * tf);
    this.lagZ.jump(this.lip.z + this.v0.z * tf);
  }

  /** Copy the inputs into the path the pour falls along. */
  private aim() {
    this.lip.copy(this.from);
    if (this.mode === 'to') {
      // Thrown level so it lands on `to`: horizontal speed = distance / fall time.
      this.surfaceY = this.to.y;
      const tf = Math.sqrt(2 * Math.max(0.001, this.from.y - this.to.y) / G);
      this.v0.set((this.to.x - this.from.x) / tf, 0, (this.to.z - this.from.z) / tf);
    } else {
      // Leaves along the lip's downhill tangent, faster the harder it pours (0.05..0.14 m/s).
      this.v0.copy(this.dir).normalize().multiplyScalar(0.05 + 0.09 * Math.min(1, this.flow));
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh, this.footMesh);
    this.mesh.geometry.dispose();
    this.footMesh.geometry.dispose();
    this.mat.dispose();
  }
}

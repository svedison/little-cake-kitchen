// A soft surface: one deformable disc that stands for the top of something runny (the
// batter in the bowl, the batter filling the pan). Nothing in here is a fluid (ADR-0002):
// it is a ring mesh whose vertices are pushed up and down by a few cheap effects.
//
//   - a mound under a landing stream (a gaussian that pulses like a stream drumming on it),
//   - rings of ripples from where something landed,
//   - short dimples where something small dropped in,
//   - per-vertex colour, so a colour poured on one side spreads out from there,
//   - an outline: a radius plus a per-angle multiplier, so a disc can be stretched to the
//     shape a tilted bowl gives its contents.
//
// The disc lies in its own XY plane with +z up; its owner rotates the mesh so +z points up
// in the world. "Disc metres" below are positions in that plane at the disc's real size.
import * as THREE from 'three';

interface Ripple { x: number; y: number; t: number; amp: number; life: number }
/** A colour spreading out from where it was poured, in disc metres. */
interface Tint { x: number; y: number; color: THREE.Color; age: number; strength: number }
/** A short dip where something small (a berry) dropped in. */
interface Dimple { x: number; y: number; t: number; depth: number }

const FOAM_R = 0.014;      // m, radius of the foam ring around a landing
const TINT_LIFE = 3.5;     // s a poured colour keeps spreading
const MAX_RIPPLES = 24;
const DIMPLE_SIGMA = 0.006; // m
const DIMPLE_LIFE = 0.5;    // s
// scratch for update(): each ripple's front radius and height this frame
const RF = new Float32Array(MAX_RIPPLES + 1);
const RA = new Float32Array(MAX_RIPPLES + 1);

export interface SoftSurfaceOptions {
  color: number;
  opacity?: number;
  roughness?: number;
  /** Vertices round the outline (the outline multiplier has one more entry, repeating the first). */
  segments?: number;
  /** Rings from the centre out. */
  rings?: number;
  /** Width of the mound under a stream (m). */
  moundSigma?: number;
  /** How much of the outer edge is held flat: 12 holds the outer 8% (a bowl's rim), 3 a third (a puddle's soft edge). */
  edgePin?: number;
}

export class SoftSurface {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.MeshStandardMaterial;
  readonly segments: number;
  /** Radius of the disc in its parent's units; written into the mesh's scale by place(). */
  radius = 0.05;
  /** Height of the disc above its owner's floor (the owner places the mesh). */
  level = 0;
  /** Outline: each angle's reach relative to `radius` (1 everywhere = round). Call shapeChanged() after writing it. */
  readonly edge: Float32Array;
  moundSigma: number;
  edgePin: number;
  /** The mound and foam under a landing stream, in disc metres. */
  readonly mound = { x: 0, y: 0, amp: 0, target: 0, foam: 0, t: 0 };
  /** Extra colouring per vertex after the poured colours (the bowl's flour dusting); c holds the colour to change. */
  shade: ((i: number, x: number, y: number, c: THREE.Color) => void) | null = null;
  /** Set when whatever `shade` paints has changed and the colours must be redrawn. */
  shadeDirty = false;
  readonly targetColor: THREE.Color;
  private globalRate = 2.5;
  private globalLeft = 0; // s the uniform colour blend still runs
  private readonly base: Float32Array;
  private readonly mix: Float32Array;              // each vertex's colour (the state)
  private readonly shown: THREE.BufferAttribute;   // mix plus foam and shading (what is drawn)
  private ripples: Ripple[] = [];
  private tints: Tint[] = [];
  private dimples: Dimple[] = [];
  private rippleT = 0;
  private flat = true;
  private shapeDirty = true;
  private readonly c = new THREE.Color();
  private readonly v = new THREE.Vector3();

  constructor(opts: SoftSurfaceOptions) {
    this.segments = opts.segments ?? 64;
    this.moundSigma = opts.moundSigma ?? 0.015;
    this.edgePin = opts.edgePin ?? 12;
    // no hole in the middle for whatever is under it to show through
    const geo = new THREE.RingGeometry(0.001, 1, this.segments, opts.rings ?? 18);
    this.base = Float32Array.from(geo.attributes.position.array as Float32Array);
    const n = geo.attributes.position.count;
    (geo.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.mix = new Float32Array(n * 3);
    this.shown = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('color', this.shown);
    this.edge = new Float32Array(this.segments + 1).fill(1);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: opts.roughness ?? 0.25, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.receiveShadow = true;
    this.targetColor = new THREE.Color(opts.color);
    this.fillColor(this.targetColor);
  }

  get vertexCount() { return this.base.length / 3; }

  /** The outline was rewritten: redraw every vertex next update. */
  shapeChanged() { this.shapeDirty = true; }

  /** Back to a round outline. */
  round() {
    if (this.edge.every((e) => e === 1)) return;
    this.edge.fill(1);
    this.shapeDirty = true;
  }

  /** A world point in disc metres (x, y in the disc's plane). */
  toDisc(world: THREE.Vector3, out: { x: number; y: number }) {
    this.mesh.updateWorldMatrix(true, false);
    const local = this.mesh.worldToLocal(this.v.copy(world));
    out.x = local.x * this.radius;
    out.y = local.y * this.radius;
    return out;
  }

  private readonly d = { x: 0, y: 0 };

  /** A ring of ripples from a world point on the surface. */
  ripple(world: THREE.Vector3, amp = 1, life = 1.6) {
    const d = this.toDisc(world, this.d);
    this.ripples.push({ x: d.x, y: d.y, t: 0, amp, life });
    if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
  }

  /**
   * A stream landing on the surface this frame. flow 0..1 is how hard it lands; tint is the
   * colour of what is poured, which spreads out from here; mound is the bump's height (m),
   * 3-5 mm growing with the flow unless given. Call every frame while it lands; the mound
   * and the foam settle by themselves once it stops.
   */
  pourAt(world: THREE.Vector3, flow: number, dt: number, tint?: number, mound?: number) {
    const d = this.toDisc(world, this.d);
    const m = this.mound;
    m.x = d.x; m.y = d.y;
    m.target = mound ?? (flow > 0.01 ? 0.003 + 0.002 * flow : 0);
    m.foam = Math.max(m.foam, Math.min(1, flow * 1.2));
    this.rippleT -= dt;
    if (flow > 0.05 && this.rippleT <= 0) {
      this.rippleT = 0.08;
      // jitter the ring centres by up to 3 mm so the rings never look stamped
      this.ripples.push({ x: m.x + (Math.random() - 0.5) * 0.006, y: m.y + (Math.random() - 0.5) * 0.006, t: 0, amp: 0.25 + 0.5 * flow, life: 0.7 });
      if (this.ripples.length > MAX_RIPPLES) this.ripples.shift();
    }
    if (tint !== undefined && flow > 0.05) this.tintAt(m.x, m.y, tint, flow * dt * 3);
  }

  /** Spread a colour out from a point (disc metres); strength adds up over calls. */
  tintAt(x: number, y: number, hex: number, strength: number) {
    this.c.set(hex);
    let t = this.tints.find((q) => q.color.equals(this.c) && Math.hypot(q.x - x, q.y - y) < 0.02 && q.age < 0.5);
    if (!t) {
      t = { x, y, color: this.c.clone(), age: 0, strength: 0 };
      this.tints.push(t);
      if (this.tints.length > 8) this.tints.shift();
    }
    t.strength = Math.min(1, t.strength + strength);
    t.age = Math.min(t.age, 0.25); // a fresh pour keeps its spot young
    // the far side catches up slowly, so a long pour ends up all one colour
    this.targetColor.set(hex);
    this.globalRate = 0.25;
    this.globalLeft = 6;
  }

  /** A colour blooming from a world point on the surface (a yolk melting in). */
  tintAtWorld(world: THREE.Vector3, hex: number, strength = 0.6) {
    const d = this.toDisc(world, this.d);
    this.c.set(hex);
    this.tints.push({ x: d.x, y: d.y, color: this.c.clone(), age: 0, strength });
    if (this.tints.length > 8) this.tints.shift();
  }

  /** Spread a colour out from a world point, merging with a fresh spot nearby (lemon drops). */
  tintSpot(world: THREE.Vector3, hex: number, strength: number) {
    const d = this.toDisc(world, this.d);
    this.tintAt(d.x, d.y, hex, strength);
  }

  /** A small dip that springs back, where something dropped in; depth in metres. */
  dimple(world: THREE.Vector3, depth = 0.003) {
    const d = this.toDisc(world, this.d);
    this.dimples.push({ x: d.x, y: d.y, t: 0, depth });
    if (this.dimples.length > 12) this.dimples.shift();
  }

  /** Blend the whole surface toward a colour (stirring evens it out). */
  setColor(hex: number, immediate = false) {
    this.targetColor.set(hex);
    this.globalRate = 2.5;
    this.globalLeft = 3;
    if (immediate) { this.tints = []; this.fillColor(this.targetColor); }
  }

  /** How far the surface is pushed up at a world point right now (m), for checks. */
  heightAt(world: THREE.Vector3, t: number) {
    const d = this.toDisc(world, this.d);
    return this.displacement(d.x, d.y, t, 1);
  }

  clear() {
    this.ripples = [];
    this.tints = [];
    this.dimples = [];
    this.mound.amp = this.mound.target = this.mound.foam = 0;
    this.shapeDirty = true;
  }

  fillColor(c: THREE.Color) {
    for (let i = 0; i < this.mix.length; i += 3) { this.mix[i] = c.r; this.mix[i + 1] = c.g; this.mix[i + 2] = c.b; }
    (this.shown.array as Float32Array).set(this.mix);
    this.shown.needsUpdate = true;
  }

  /** Scale the mesh to the radius (its owner sets its position and orientation). */
  place() {
    this.mesh.scale.setScalar(Math.max(1e-4, this.radius));
  }

  update(dt: number, t: number) {
    this.place();
    const m = this.mound;
    m.amp += (m.target - m.amp) * (1 - Math.exp(-14 * dt));
    m.target = 0; // pourAt sets it again next frame while the stream still lands
    m.foam *= Math.exp(-3 * dt);
    m.t += dt;
    if (!this.mesh.visible) return;
    this.updateColors(dt);

    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < r.life);
    for (const d of this.dimples) d.t += dt;
    this.dimples = this.dimples.filter((d) => d.t < DIMPLE_LIFE);
    const pos = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const s = this.radius;
    const still = !this.ripples.length && m.amp <= 2e-5 && !this.dimples.length;
    if (still && this.flat && !this.shapeDirty) return;
    const ring = this.segments + 1;
    const edge = this.edge;
    const base = this.base;
    if (still) {
      // Flatten once, when the ripples and the mound have died out (or the outline changed).
      for (let i = 0, k = 0; k < arr.length; i++, k += 3) {
        const e = edge[i % ring];
        arr[k] = base[k] * e; arr[k + 1] = base[k + 1] * e; arr[k + 2] = 0;
      }
      pos.needsUpdate = true;
      this.mesh.geometry.computeVertexNormals();
      this.mesh.geometry.computeBoundingSphere();
      this.flat = true;
      this.shapeDirty = false;
      return;
    }
    this.flat = false;
    this.prepare(t);
    const pin = this.edgePin;
    for (let i = 0, k = 0; k < arr.length; i++, k += 3) {
      const e = edge[i % ring];
      const bx = base[k] * e, by = base[k + 1] * e;
      // the edge is held still, so nothing pokes through what holds the surface
      const rho = Math.hypot(base[k], base[k + 1]);
      const hold = Math.min(1, (1 - rho) * pin);
      arr[k] = bx; arr[k + 1] = by;
      arr[k + 2] = (this.displacement(bx * s, by * s, t, 0) * hold) / Math.max(s, 0.01);
    }
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    if (this.shapeDirty) this.mesh.geometry.computeBoundingSphere();
    this.shapeDirty = false;
  }

  // Per frame, once: the pulse, and how far each ripple's front has got and how tall it still is.
  private pulse = 0;
  private prepare(t: number) {
    // The mound pulses at 6 Hz by 10%, like a stream drumming on the surface.
    this.pulse = this.mound.amp * (1 + 0.1 * Math.sin(t * Math.PI * 2 * 6));
    const rs = this.ripples;
    for (let j = 0; j < rs.length; j++) {
      const r = rs[j];
      RF[j] = 0.13 * r.t + 0.012;
      RA[j] = 0.0035 * r.amp * Math.exp(-2.6 * r.t);
    }
  }

  /** Height (m) of the surface at a point in disc metres; fresh=1 recomputes the per-frame numbers. */
  private displacement(x: number, y: number, t: number, fresh: number) {
    if (fresh) this.prepare(t);
    const m = this.mound;
    const sig = this.moundSigma;
    let z = 0;
    if (m.amp > 2e-5) {
      const dx = x - m.x, dy = y - m.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < 16 * sig * sig) z += this.pulse * Math.exp(-d2 / (2 * sig * sig));
    }
    const rs = this.ripples;
    for (let j = 0; j < rs.length; j++) {
      const r = rs[j];
      const dx = x - r.x, dy = y - r.y;
      const d2 = dx * dx + dy * dy;
      const front = RF[j];
      if (d2 >= front * front) continue;
      const d = Math.sqrt(d2);
      z += RA[j] * Math.sin(170 * d - 22 * r.t) * (1 - d / front);
    }
    const inv = 1 / (2 * DIMPLE_SIGMA * DIMPLE_SIGMA);
    for (const dm of this.dimples) {
      const dx = x - dm.x, dy = y - dm.y;
      const k = 1 - dm.t / DIMPLE_LIFE;
      z -= dm.depth * k * k * Math.exp(-(dx * dx + dy * dy) * inv);
    }
    return z;
  }

  /** Blend every vertex toward the uniform target, then let each poured colour spread out. */
  private updateColors(dt: number) {
    const foam = this.mound.foam;
    if (this.globalLeft <= 0 && !this.tints.length && foam < 0.01 && !this.shadeDirty) return;
    const s = this.radius;
    const mix = this.mix;
    const shown = this.shown.array as Float32Array;
    const gk = this.globalLeft > 0 ? 1 - Math.exp(-this.globalRate * dt) : 0;
    this.globalLeft -= dt;
    const tc = this.targetColor;
    for (const q of this.tints) q.age += dt;
    this.tints = this.tints.filter((q) => q.age < TINT_LIFE);
    const m = this.mound;
    const ring = this.segments + 1;
    const c = this.c;
    for (let i = 0, k = 0; k < mix.length; i++, k += 3) {
      const e = this.edge[i % ring] * s;
      const x = this.base[k] * e, y = this.base[k + 1] * e;
      if (gk > 0) {
        mix[k] += (tc.r - mix[k]) * gk;
        mix[k + 1] += (tc.g - mix[k + 1]) * gk;
        mix[k + 2] += (tc.b - mix[k + 2]) * gk;
      }
      for (const q of this.tints) {
        // a soft spot that widens as it ages: 1.5 cm at first, most of the bowl after 3 s
        const sigma = 0.015 + 0.03 * q.age;
        const dx = x - q.x, dy = y - q.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 9 * sigma * sigma) continue;
        const w = Math.exp(-d2 / (2 * sigma * sigma));
        const kk = 1 - Math.exp(-5 * q.strength * w * dt);
        mix[k] += (q.color.r - mix[k]) * kk;
        mix[k + 1] += (q.color.g - mix[k + 1]) * kk;
        mix[k + 2] += (q.color.b - mix[k + 2]) * kk;
      }
      c.setRGB(mix[k], mix[k + 1], mix[k + 2]);
      if (this.shade) this.shade(i, x, y, c);
      let f = 0;
      if (foam > 0.01) {
        const d = Math.hypot(x - m.x, y - m.y);
        f = 0.55 * foam * Math.exp(-Math.pow((d - FOAM_R) / 0.004, 2));
      }
      shown[k] = c.r + (1 - c.r) * f;
      shown[k + 1] = c.g + (1 - c.g) * f;
      shown[k + 2] = c.b + (1 - c.b) * f;
    }
    this.shown.needsUpdate = true;
  }
}

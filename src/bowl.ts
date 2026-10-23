// The mixing bowl and whatever is in it. The contents are one soft surface (surface.ts)
// that rises, changes colour and ripples; nothing in here is a fluid (ADR-0002).
//
// A pour talks to it through pourAt(): the stream's landing raises a little pulsing mound
// there, sends out rings of ripples, lightens a ring of foam around itself, and its colour
// spreads outward from that point. The level is integrated from the flow, so it rises for
// as long as the pour lands and stops when the last of it has.
//
// Tipped (the pour into the pan), the contents stay level with the world, the way batter
// does: the surface is the cut of a horizontal plane through the inside of the bowl, never
// higher than the lowest point of the rim, so as the bowl tips it slides and stretches
// toward the lip and shrinks away as the bowl empties.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Kitchen, P } from './kitchen';
import { SoftSurface } from './surface';

// The bowl is drawn at 85% of its first size so the cat and the front slot fit beside it on a phone.
const SIZE = 0.85;
// Inner profile of the bowl: height above the floor -> radius.
const INNER: [number, number][] = [[0, 0.07 * SIZE], [0.044, 0.11 * SIZE], [0.089, 0.125 * SIZE]];
const DUST_SETTLE = 4;      // s a flour dusting takes to sink in once the sifting stops
const OPACITY = 0.92;
/** What is left clinging to the bowl once it has been poured out: a thin, see-through coat. */
export const SMEAR = { level: 0.003, opacity: 0.6 };
const PLANE_REACH = 0.2;    // m, further than a tipped surface can reach from its centre
const QFLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

export class Bowl {
  readonly group = new THREE.Group();
  readonly home: THREE.Vector3;
  readonly rimRadius = 0.135 * SIZE;
  /** Non-physical decorations that ride along with the bowl (yolks, berries on the batter, lumps). */
  readonly contents = new THREE.Group();
  readonly rimY = 0.095;
  readonly floorY = 0.006;
  /** The pouring lip in the bowl's own frame: the middle of the rim's top, at the front (+z). */
  readonly lip = new THREE.Vector3(0, 0.095, 0.13 * SIZE);
  readonly collider: RAPIER.Collider;
  readonly soft: SoftSurface;
  readonly surface: THREE.Mesh;
  level = 0;
  spin = 0;
  private targetLevel = 0;
  private opacity = OPACITY;
  private targetOpacity = OPACITY;
  // flour sifted onto the surface: a pale speckled patch (disc metres) and a matte mound
  private readonly dust = { x: 0, y: 0, r: 0, amount: 0, k: 0, idle: 0, color: new THREE.Color(), dirty: false };
  private readonly powder: THREE.Mesh;
  private readonly speckle: Float32Array;
  // the tipped surface: the world's up in the bowl's frame, and the plane's height along it
  private readonly upLocal = new THREE.Vector3(0, 1, 0);
  private planeD = 0;
  private tipped = false;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly ex = new THREE.Vector3();
  private readonly ey = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();

  constructor(private readonly k: Kitchen, home: THREE.Vector3) {
    this.home = home.clone();
    this.group.position.copy(home);
    k.scene.add(this.group);

    // Outside goes up from the base to the rim, then the inside comes back down to the floor.
    const profile = [
      [0, 0], [0.08, 0], [0.12, 0.045], [0.135, 0.095],
      [0.125, 0.095], [0.11, 0.05], [0.07, 0.006], [0, 0.006],
    ].map(([x, y]) => new THREE.Vector2(x * SIZE, y));
    const geo = new THREE.LatheGeometry(profile, 64);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: P.matcha, roughness: 0.45, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(home.x, home.y, home.z));
    const verts = geo.attributes.position.array as Float32Array;
    const idx = Uint32Array.from(geo.index!.array);
    this.collider = k.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8), body);

    this.soft = new SoftSurface({ color: P.white, opacity: OPACITY, roughness: 0.25 });
    this.surface = this.soft.mesh;
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.visible = false;
    this.group.add(this.surface);
    this.group.add(this.contents);
    // per-vertex grain for the dusting, so it reads as powder rather than paint
    const n = this.soft.vertexCount;
    this.speckle = new Float32Array(n);
    for (let i = 0; i < n; i++) { const h = Math.sin(i * 12.9898) * 43758.5453; this.speckle[i] = 0.7 + 0.3 * (h - Math.floor(h)); }
    this.soft.shade = (i, x, y, c) => this.shadeDust(i, x, y, c);

    // The flour mound: a lumpy, fully matte dome riding on the surface (its up is the surface's +z).
    const pgeo = new THREE.SphereGeometry(1, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const pp = pgeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const lump = 1 + 0.12 * Math.sin(x * 9 + z * 5) * Math.cos(z * 7 - x * 3) * y; // tuned by eye
      pp.setXYZ(i, x * lump, y * lump, z * lump);
    }
    pgeo.rotateX(Math.PI / 2);
    pgeo.computeVertexNormals();
    this.powder = new THREE.Mesh(pgeo, new THREE.MeshStandardMaterial({ color: 0xfffdf7, roughness: 1 }));
    this.powder.name = 'powder';
    this.powder.visible = false;
    this.powder.receiveShadow = true;
    this.surface.add(this.powder);

    k.updaters.add((dt, t) => this.update(dt, t));
  }

  /** Inner radius of the bowl at a height above the floor. */
  radiusAt(h: number) {
    for (let i = 1; i < INNER.length; i++) {
      const [h0, r0] = INNER[i - 1];
      const [h1, r1] = INNER[i];
      if (h <= h1) return THREE.MathUtils.lerp(r0, r1, THREE.MathUtils.clamp((h - h0) / (h1 - h0), 0, 1));
    }
    return INNER[INNER.length - 1][1];
  }

  /** Radius of the contents' surface right now (resting). */
  surfaceRadius() { return this.radiusAt(this.level); }

  /** Fill height above the floor (0 = empty). Eases unless immediate. */
  setLevel(level: number, immediate = false) {
    this.targetLevel = level;
    if (immediate) { this.level = level; this.orient(); }
  }

  /** Raise the contents right now by dl (a pour integrates its flow into this). */
  addLevel(dl: number) {
    const max = this.rimY - this.floorY - 0.015;
    this.level = Math.min(max, this.level + dl);
    this.targetLevel = Math.min(max, this.targetLevel + dl);
  }

  /** Poured out: what is left eases down to a thin see-through coat instead of vanishing. */
  smear() {
    this.targetLevel = SMEAR.level;
    this.targetOpacity = SMEAR.opacity;
  }

  /** Blend the whole surface toward a colour (stirring evens it out). */
  setColor(hex: number, immediate = false) { this.soft.setColor(hex, immediate); }

  /** World y of the top of the contents (resting at home). */
  surfaceY() { return this.home.y + this.floorY + this.level; }

  /** The pouring lip in world space, wherever the bowl is. */
  lipWorld(out: THREE.Vector3) {
    return out.copy(this.lip).multiply(this.group.scale).applyQuaternion(this.group.quaternion).add(this.group.position);
  }

  /** A ring of ripples from a world point on the surface. */
  ripple(world: THREE.Vector3, amp = 1, life = 1.6) { this.soft.ripple(world, amp, life); }

  /**
   * A stream landing on the surface this frame. flow 0..1 is how hard it lands (the
   * stream's flow times its landed fraction); tint is the colour of what is poured, which
   * spreads out from here. Call every frame while it lands.
   */
  pourAt(world: THREE.Vector3, flow: number, dt: number, tint?: number) { this.soft.pourAt(world, flow, dt, tint); }

  /** A colour blooming from a world point on the surface (a yolk melting in). */
  tintAtWorld(world: THREE.Vector3, hex: number, strength = 0.6) { this.soft.tintAtWorld(world, hex, strength); }

  /** Spread a colour out from a world point, merging with a fresh spot nearby (lemon drops). */
  tintSpot(world: THREE.Vector3, hex: number, strength: number) { this.soft.tintSpot(world, hex, strength); }

  /** A small dip that springs back, where something dropped in; depth in metres. */
  dimple(world: THREE.Vector3, depth = 0.003) { this.soft.dimple(world, depth); }

  /**
   * Flour landing on the surface: amount is its share of a whole cup (they add up to ~1).
   * A pale speckled patch spreads out from the first landing and a matte mound builds there;
   * once the sifting stops, both sink into the batter over a few seconds.
   */
  dustAt(world: THREE.Vector3, amount: number, hex: number) {
    const at = this.soft.toDisc(world, { x: 0, y: 0 });
    const d = this.dust;
    if (d.amount === 0) { d.x = at.x; d.y = at.y; d.color.set(hex); } else { d.x += (at.x - d.x) * 0.01; d.y += (at.y - d.y) * 0.01; }
    d.amount += amount;
    d.k = Math.min(1, d.k + amount * 6);
    d.idle = 0;
    d.dirty = true;
    // The patch only ever grows, and never past the batter's edge (tuned by eye: ~5 cm across for a cup).
    const edge = this.surfaceRadius() - 0.006 - Math.hypot(d.x, d.y);
    d.r = Math.max(d.r, Math.min(edge, 0.008 + 0.03 * Math.sqrt(Math.min(1.5, d.amount))));
    // and the batter underneath slowly takes its colour
    this.soft.tintAt(at.x, at.y, hex, amount * 0.6);
  }

  /** Radius of the flour dusting patch (m), for checks. */
  get dustRadius() { return this.dust.r; }

  /** Height of the mound right now (m), for checks. */
  get moundHeight() { return this.soft.mound.amp; }

  /**
   * Is a point in the bowl's own frame above the contents (or are they gone)? A berry that
   * is uncovered as the bowl tips rolls out over the lip.
   */
  uncovered(local: THREE.Vector3, margin = 0) {
    if (!this.surface.visible) return true;
    return local.dot(this.upLocal) > this.planeD - margin;
  }

  /** The surface as a check sees it: how far its up is from the world's, and how far it has slid toward the lip (m). */
  surfaceInfo() {
    this.surface.updateWorldMatrix(true, false);
    const up = this.v.set(0, 0, 1).transformDirection(this.surface.matrixWorld);
    const upDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(up.y, -1, 1)));
    const toLip = this.w.copy(this.lip).setY(0).normalize();
    const shift = this.surface.position.x * toLip.x + this.surface.position.z * toLip.z;
    return { visible: this.surface.visible, upDeg, shift, radius: this.soft.radius, level: this.level, opacity: this.opacity, tipped: this.tipped };
  }

  clear() {
    this.setLevel(0, true);
    this.soft.clear();
    Object.assign(this.dust, { r: 0, amount: 0, k: 0, idle: 0, dirty: true });
    this.powder.visible = false;
    this.spin = 0;
    this.opacity = this.targetOpacity = OPACITY;
    this.soft.mat.opacity = OPACITY;
    this.contents.clear();
  }

  /** Put the surface where the contents are: resting on the level, or level with the world when tipped. */
  private orient() {
    const up = this.upLocal.set(0, 1, 0).applyQuaternion(this.q.copy(this.group.quaternion).invert());
    const level = this.floorY + this.level + 0.002;
    this.tipped = up.y < 0.9995;
    if (!this.tipped) {
      this.surface.position.set(0, level, 0);
      this.surface.rotation.set(-Math.PI / 2, 0, this.surface.rotation.z);
      this.soft.round();
      this.soft.radius = this.radiusAt(this.level);
      this.planeD = level;
      this.surface.visible = this.level > 0.001;
      return;
    }
    // The plane sits where the level would be, but never above the lowest point of the rim's
    // inner edge (less 3 mm: that is where the batter runs over).
    const tilt = Math.hypot(up.x, up.z);
    const rimLow = this.rimY * up.y - this.radiusAt(this.rimY - this.floorY) * tilt;
    const d = this.planeD = Math.min(level * up.y, rimLow - 0.003);
    // Start on the bowl's axis at that plane.
    const c = this.c.set(0, d / Math.max(0.1, up.y), 0);
    if (this.level <= 0.001 || up.y < 0.1 || !this.inside(c)) { this.surface.visible = false; return; }
    this.surface.quaternion.copy(this.q).multiply(QFLAT); // level with the world
    this.ex.set(1, 0, 0).applyQuaternion(this.surface.quaternion);
    this.ey.set(0, 1, 0).applyQuaternion(this.surface.quaternion);
    // Downhill in the plane, toward the low rim: centre the disc between its two ends that way.
    const down = this.w.set(-up.x / tilt, 0, -up.z / tilt).addScaledVector(up, tilt).normalize();
    const fwd = this.reach(c, down);
    const back = this.reach(c, this.dir.copy(down).negate());
    c.addScaledVector(down, (fwd - back) / 2);
    const soft = this.soft;
    const n = soft.segments;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.dir.copy(this.ex).multiplyScalar(Math.cos(a)).addScaledVector(this.ey, Math.sin(a));
      const r = this.reach(c, this.dir);
      soft.edge[i] = r;
      max = Math.max(max, r);
    }
    soft.radius = Math.max(max, 0.004);
    for (let i = 0; i < n; i++) soft.edge[i] = Math.max(0.02, soft.edge[i] / soft.radius);
    soft.edge[n] = soft.edge[0];
    soft.shapeChanged();
    this.surface.position.copy(c);
    this.surface.visible = max > 0.006;
  }

  /** Is a point in the bowl's frame inside the bowl (above the floor, inside the wall, under the rim)? */
  private inside(p: THREE.Vector3) {
    const h = p.y - this.floorY;
    if (h < 0 || h > this.rimY - this.floorY) return false;
    return Math.hypot(p.x, p.z) < this.radiusAt(h) - 0.002;
  }

  /** How far from c along dir the inside of the bowl reaches (it is convex, so a bisection finds the wall). */
  private reach(c: THREE.Vector3, dir: THREE.Vector3) {
    let lo = 0, hi = PLANE_REACH;
    for (let k = 0; k < 11; k++) {
      const mid = (lo + hi) / 2;
      if (this.inside(this.p.copy(c).addScaledVector(dir, mid))) lo = mid; else hi = mid;
    }
    return lo;
  }

  private update(dt: number, t: number) {
    this.level += (this.targetLevel - this.level) * (1 - Math.exp(-3 * dt));
    this.opacity += (this.targetOpacity - this.opacity) * (1 - Math.exp(-3 * dt));
    this.soft.mat.opacity = this.opacity;
    this.orient();
    if (!this.tipped) this.surface.rotation.z += this.spin * dt;
    this.spin *= Math.exp(-2 * dt);
    this.updateDust(dt);
    const d = this.dust;
    this.soft.shadeDirty = d.dirty;
    d.dirty = d.k > 0.002;
    this.soft.update(dt, t);
  }

  /** The flour dusting's pale speckle, painted over the batter's colour. */
  private shadeDust(i: number, x: number, y: number, c: THREE.Color) {
    const d = this.dust;
    if (d.k <= 0.002 || d.r <= 0) return;
    const dd = Math.hypot(x - d.x, y - d.y);
    if (dd >= d.r) return;
    const w = d.k * this.speckle[i] * (1 - THREE.MathUtils.smoothstep(dd, d.r * 0.45, d.r));
    c.r += (d.color.r - c.r) * w; c.g += (d.color.g - c.g) * w; c.b += (d.color.b - c.b) * w;
  }

  /** The flour mound grows with what has landed; once the sifting stops it sinks in. */
  private updateDust(dt: number) {
    const d = this.dust;
    if (d.amount <= 0 || !this.surface.visible) { this.powder.visible = false; return; }
    d.idle += dt;
    if (d.idle > 0.6 && d.k > 0) { d.k = Math.max(0, d.k - dt / DUST_SETTLE); d.dirty = true; }
    const settle = Math.min(1, d.k * 1.5);
    const s = this.soft.radius;
    // a cup's worth makes a soft heap ~2.5 cm across and 7 mm tall (tuned by eye)
    const grow = Math.sqrt(Math.min(1.2, d.amount));
    const rad = Math.min(d.r * 0.6, 0.013 * grow + 0.003);
    const h = 0.007 * grow * settle;
    this.powder.visible = h > 0.0003;
    this.powder.position.set(d.x / s, d.y / s, 0);
    this.powder.scale.set(rad / s, rad / s, Math.max(h, 1e-5) / s);
  }
}

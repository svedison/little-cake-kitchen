// The mixing bowl and whatever is in it. The contents are one deformable surface disc
// that rises, changes colour and ripples; nothing in here is a fluid (ADR-0002).
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Kitchen, P } from './kitchen';

interface Ripple { x: number; y: number; t: number; amp: number }

// Inner profile of the bowl: height above the floor -> radius.
const INNER: [number, number][] = [[0, 0.07], [0.044, 0.11], [0.089, 0.125]];

export class Bowl {
  readonly group = new THREE.Group();
  readonly home: THREE.Vector3;
  readonly rimRadius = 0.13;
  readonly rimY = 0.095;
  readonly floorY = 0.006;
  readonly collider: RAPIER.Collider;
  readonly surface: THREE.Mesh;
  readonly surfaceMat: THREE.MeshStandardMaterial;
  level = 0;
  spin = 0;
  private targetLevel = 0;
  private targetColor = new THREE.Color(P.white);
  private readonly base: Float32Array;
  private ripples: Ripple[] = [];

  constructor(private readonly k: Kitchen, home: THREE.Vector3) {
    this.home = home.clone();
    this.group.position.copy(home);
    k.scene.add(this.group);

    // Outside goes up from the base to the rim, then the inside comes back down to the floor.
    const profile = [
      [0, 0], [0.08, 0], [0.12, 0.045], [0.135, 0.095],
      [0.125, 0.095], [0.11, 0.05], [0.07, 0.006], [0, 0.006],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(profile, 64);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: P.matcha, roughness: 0.45, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);

    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(home.x, home.y, home.z));
    const verts = geo.attributes.position.array as Float32Array;
    const idx = Uint32Array.from(geo.index!.array);
    this.collider = k.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8), body);

    const sgeo = new THREE.RingGeometry(0.02, 1, 64, 18);
    this.base = Float32Array.from(sgeo.attributes.position.array as Float32Array);
    this.surfaceMat = new THREE.MeshStandardMaterial({ color: P.white, roughness: 0.25, transparent: true, opacity: 0.92 });
    this.surface = new THREE.Mesh(sgeo, this.surfaceMat);
    this.surface.rotation.x = -Math.PI / 2;
    this.surface.visible = false;
    this.surface.receiveShadow = true;
    this.group.add(this.surface);

    k.updaters.add((dt) => this.update(dt));
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

  /** Fill height above the floor (0 = empty). Eases unless immediate. */
  setLevel(level: number, immediate = false) {
    this.targetLevel = level;
    if (immediate) { this.level = level; this.place(); }
  }

  setColor(hex: number, immediate = false) {
    this.targetColor.set(hex);
    if (immediate) this.surfaceMat.color.set(hex);
  }

  /** World y of the top of the contents. */
  surfaceY() { return this.home.y + this.floorY + this.level; }

  /** Where the finger's bowl-plane point lands on the surface, in world space. */
  ripple(world: THREE.Vector3, amp = 1) {
    const local = this.surface.worldToLocal(world.clone());
    this.ripples.push({ x: local.x, y: local.y, t: 0, amp });
    if (this.ripples.length > 12) this.ripples.shift();
  }

  clear() {
    this.setLevel(0, true);
    this.ripples = [];
    this.spin = 0;
  }

  private place() {
    const r = this.radiusAt(this.level);
    this.surface.position.y = this.floorY + this.level + 0.002;
    this.surface.scale.setScalar(r);
    this.surface.visible = this.level > 0.001;
  }

  private update(dt: number) {
    this.level += (this.targetLevel - this.level) * (1 - Math.exp(-3 * dt));
    this.surfaceMat.color.lerp(this.targetColor, 1 - Math.exp(-2.5 * dt));
    this.place();
    this.surface.rotation.z += this.spin * dt;
    this.spin *= Math.exp(-2 * dt);
    if (!this.surface.visible) return;

    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 1.6);
    const pos = this.surface.geometry.attributes.position as THREE.BufferAttribute;
    const s = this.surface.scale.x;
    if (!this.ripples.length) {
      // Flatten once the ripples die out; cheap enough to do every frame.
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) !== 0) pos.setZ(i, 0);
      pos.needsUpdate = true;
      return;
    }
    for (let i = 0; i < pos.count; i++) {
      const x = this.base[i * 3] * s;
      const y = this.base[i * 3 + 1] * s;
      let z = 0;
      for (const r of this.ripples) {
        const d = Math.hypot(x - r.x, y - r.y);
        const front = 0.13 * r.t + 0.012;
        if (d < front) z += 0.0035 * r.amp * Math.exp(-2.6 * r.t) * Math.sin(170 * d - 22 * r.t) * (1 - d / front);
      }
      pos.setZ(i, z / Math.max(s, 0.01));
    }
    pos.needsUpdate = true;
    this.surface.geometry.computeVertexNormals();
  }
}

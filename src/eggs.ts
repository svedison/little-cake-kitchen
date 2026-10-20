// Step: crack the eggs. Pick an egg out of the carton, knock it on the rim of the
// bowl (or drop it in) and the shell splits, the yolk plops in and the white pools.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Kitchen, P } from './kitchen';
import { sound } from './sound';

const EGG_R = 0.021;            // half width
const EGG_H = EGG_R * 1.33;     // half height
const KNOCK_SPEED = 0.35;       // m/s across the rim to crack
const GRAB_PX = 56;             // how close a finger must be to an egg, in CSS pixels
const RIM_BAND = { inner: 0.025, outer: 0.015 };

type EggState = 'carton' | 'held' | 'falling' | 'returning' | 'cracked';

interface Egg {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  slot: THREE.Vector3;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  state: EggState;
  prevDist: number;
  returnT: number;
}

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  age: number;
  landed: boolean;
  squish: number;
  kind: 'shell' | 'yolk';
}

interface Ripple { x: number; y: number; t: number }

export interface EggStepEvents {
  onProgress(cracked: number, total: number): void;
  onDone(): void;
}

/** An egg shape: a sphere pulled taller and tapered at the top. */
function eggGeometry(r: number, thetaStart = 0, thetaLength = Math.PI) {
  const g = new THREE.SphereGeometry(r, 28, 20, 0, Math.PI * 2, thetaStart, thetaLength);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / r;
    const s = y > 0 ? 1 - 0.2 * y : 1 + 0.04 * y;
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * 1.33, p.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

export class EggStep {
  readonly total = 3;
  cracked = 0;
  landed = 0;
  private done = false;
  private eggs: Egg[] = [];
  private debris: Debris[] = [];
  private held: Egg | null = null;
  private pointer = { x: 0, y: 0 };
  private readonly holdY: number;
  private readonly eggGeo = eggGeometry(EGG_R);
  private readonly shellTopGeo = eggGeometry(EGG_R, 0, Math.PI / 2);
  private readonly shellBottomGeo = eggGeometry(EGG_R, Math.PI / 2, Math.PI / 2);
  private readonly eggMat = new THREE.MeshStandardMaterial({ color: P.shell, roughness: 0.55 });
  private readonly yolkGeo = new THREE.SphereGeometry(0.016, 24, 16);
  private readonly yolkMat = new THREE.MeshStandardMaterial({ color: P.yolk, roughness: 0.3 });
  private readonly pool: THREE.Mesh;
  private readonly poolBase: Float32Array;
  private ripples: Ripple[] = [];
  private poolScale = 0;
  private readonly cartonPos = new THREE.Vector3(0, 0, 0.16);

  constructor(private readonly k: Kitchen, private readonly events: EggStepEvents) {
    this.holdY = k.bowl.rimY + EGG_H + 0.004;
    this.addCarton();
    for (let i = 0; i < this.total; i++) this.eggs.push(this.makeEgg(new THREE.Vector3((i - 1) * 0.062, 0.03 + EGG_H - 0.012, this.cartonPos.z)));

    // The egg white: a disc on the bowl floor that grows with each egg and ripples when a yolk lands.
    const geo = new THREE.RingGeometry(0.002, 0.078, 64, 20);
    this.poolBase = Float32Array.from(geo.attributes.position.array as Float32Array);
    this.pool = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: P.white, roughness: 0.2, transparent: true, opacity: 0.85 }));
    this.pool.rotation.x = -Math.PI / 2;
    this.pool.position.copy(k.bowl.center).add(new THREE.Vector3(0, k.bowl.floorY + 0.004, 0));
    this.pool.visible = false;
    this.pool.receiveShadow = true;
    k.scene.add(this.pool);

    const canvas = k.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    k.onCollision.add((a, b) => this.onCollision(a, b));
    k.updaters.add((dt, t) => this.update(dt, t));
  }

  /** Put all three eggs back in the carton and clear the bowl. */
  reset() {
    for (const d of this.debris) this.removeDebris(d);
    this.debris = [];
    for (const egg of this.eggs) {
      if (egg.body) this.k.world.removeRigidBody(egg.body);
      this.k.scene.remove(egg.mesh);
    }
    this.eggs = this.eggs.map((e) => this.makeEgg(e.slot));
    this.held = null;
    this.cracked = 0;
    this.landed = 0;
    this.done = false;
    this.poolScale = 0;
    this.pool.visible = false;
    this.ripples = [];
    this.events.onProgress(0, this.total);
  }

  /** Screen positions of things a test driver might want to touch. */
  screen() {
    const k = this.k;
    const dir = new THREE.Vector3(0, 0, 1); // the rim nearest the camera
    const at = (r: number) => k.toScreen(k.bowl.center.clone().addScaledVector(dir, r).setY(this.holdY));
    return {
      eggs: this.eggs.map((e) => k.toScreen(e.pos)),
      outside: at(k.bowl.rimRadius + 0.06),
      inside: at(k.bowl.rimRadius - 0.06),
      center: at(0),
    };
  }

  // ---- building ------------------------------------------------------------

  private addCarton() {
    const k = this.k;
    const carton = new THREE.Group();
    carton.position.copy(this.cartonPos);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.075), new THREE.MeshStandardMaterial({ color: 0xffcdd5, roughness: 0.95 }));
    base.position.y = 0.015;
    base.castShadow = true;
    base.receiveShadow = true;
    carton.add(base);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xf7b9c4, roughness: 0.95 });
    for (let i = -1; i <= 1; i++) {
      const cup = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.006, 10, 28), cupMat);
      cup.rotation.x = Math.PI / 2;
      cup.position.set(i * 0.062, 0.03, 0);
      cup.castShadow = true;
      carton.add(cup);
    }
    k.scene.add(carton);
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(this.cartonPos.x, 0.015, this.cartonPos.z));
    k.world.createCollider(RAPIER.ColliderDesc.cuboid(0.105, 0.015, 0.0375), body);
  }

  private makeEgg(slot: THREE.Vector3): Egg {
    const k = this.k;
    const mesh = new THREE.Mesh(this.eggGeo, this.eggMat);
    mesh.castShadow = true;
    mesh.position.copy(slot);
    k.scene.add(mesh);
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(slot.x, slot.y, slot.z));
    const collider = k.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.008, 0.02).setRestitution(0.1).setFriction(0.6).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    return { mesh, body, collider, slot: slot.clone(), pos: slot.clone(), prev: slot.clone(), vel: new THREE.Vector3(), state: 'carton', prevDist: Infinity, returnT: 0 };
  }

  // ---- input ---------------------------------------------------------------

  private onDown(e: PointerEvent) {
    if (this.held || this.done) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    let best: Egg | null = null;
    let bestD = GRAB_PX;
    for (const egg of this.eggs) {
      if (egg.state !== 'carton' && egg.state !== 'returning') continue;
      const s = this.k.toScreen(egg.pos);
      const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
      if (d < bestD) { bestD = d; best = egg; }
    }
    if (!best) return;
    this.k.renderer.domElement.setPointerCapture(e.pointerId);
    best.state = 'held';
    best.prevDist = this.distToBowl(best.pos);
    this.held = best;
  }

  private onMove(e: PointerEvent) {
    this.pointer = { x: e.clientX, y: e.clientY };
  }

  private onUp(e: PointerEvent) {
    const egg = this.held;
    if (!egg) return;
    this.held = null;
    try { this.k.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (egg.state !== 'held') return;
    const over = this.distToBowl(egg.pos) < this.k.bowl.rimRadius - 0.03;
    if (over && egg.body) {
      // Let go over the bowl: the egg really falls and cracks on whatever it hits.
      egg.state = 'falling';
      egg.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      egg.body.setLinvel({ x: egg.vel.x * 0.5, y: Math.min(egg.vel.y, 0), z: egg.vel.z * 0.5 }, true);
      egg.body.setAngvel({ x: egg.vel.z * 8, y: 0, z: -egg.vel.x * 8 }, true);
    } else {
      egg.state = 'returning';
      egg.returnT = 0;
      egg.prev.copy(egg.pos);
    }
  }

  // ---- per frame -----------------------------------------------------------

  private update(dt: number, t: number) {
    for (const egg of this.eggs) {
      switch (egg.state) {
        case 'held': this.updateHeld(egg, dt, t); break;
        case 'falling': this.updateFalling(egg); break;
        case 'returning': this.updateReturning(egg, dt); break;
        case 'carton': egg.mesh.rotation.set(0, 0, 0); break;
      }
    }
    for (const d of this.debris) this.updateDebris(d, dt);
    this.debris = this.debris.filter((d) => {
      if (d.kind === 'shell' && d.age > 3) { this.removeDebris(d); return false; }
      return true;
    });
    this.updatePool(dt);
  }

  private updateHeld(egg: Egg, dt: number, t: number) {
    const target = this.k.pointOnPlane(this.k.ray(this.pointer.x, this.pointer.y), this.holdY);
    if (target) {
      target.x = THREE.MathUtils.clamp(target.x, -0.3, 0.3);
      target.z = THREE.MathUtils.clamp(target.z, -0.32, 0.3);
      egg.pos.lerp(target, 1 - Math.exp(-20 * dt));
    }
    egg.vel.subVectors(egg.pos, egg.prev).divideScalar(Math.max(dt, 1e-3));
    egg.prev.copy(egg.pos);

    // Crossing the rim band fast enough knocks the shell; slowly just touches it.
    const d = this.distToBowl(egg.pos);
    const rim = this.k.bowl.rimRadius;
    const enteredFromOutside = egg.prevDist > rim + RIM_BAND.outer && d <= rim + RIM_BAND.outer;
    const enteredFromInside = egg.prevDist < rim - RIM_BAND.inner && d >= rim - RIM_BAND.inner;
    egg.prevDist = d;
    if (enteredFromOutside || enteredFromInside) {
      const speed = Math.hypot(egg.vel.x, egg.vel.z);
      if (speed > KNOCK_SPEED) {
        const inward = new THREE.Vector3(this.k.bowl.center.x - egg.pos.x, 0, this.k.bowl.center.z - egg.pos.z).normalize();
        this.crack(egg, egg.pos.clone(), inward);
        return;
      }
      sound.play('tap', { gain: Math.min(1, speed * 2 + 0.2) });
    }

    egg.mesh.position.copy(egg.pos);
    egg.mesh.rotation.set(
      THREE.MathUtils.clamp(egg.vel.z * 0.7, -0.5, 0.5) + Math.sin(t * 9) * 0.03,
      0,
      THREE.MathUtils.clamp(-egg.vel.x * 0.7, -0.5, 0.5) + Math.cos(t * 7) * 0.03,
    );
    egg.body?.setNextKinematicTranslation({ x: egg.pos.x, y: egg.pos.y, z: egg.pos.z });
  }

  private updateFalling(egg: Egg) {
    if (!egg.body) return;
    const p = egg.body.translation();
    const q = egg.body.rotation();
    egg.pos.set(p.x, p.y, p.z);
    egg.mesh.position.copy(egg.pos);
    egg.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    const v = egg.body.linvel();
    egg.vel.set(v.x, v.y, v.z);
    // Safety net: if it somehow slips through the bowl, crack it where it is.
    if (p.y < this.k.bowl.floorY - 0.03) this.crack(egg, egg.pos.clone(), null);
  }

  private updateReturning(egg: Egg, dt: number) {
    egg.returnT = Math.min(1, egg.returnT + dt / 0.35);
    const e = 1 - Math.pow(1 - egg.returnT, 3);
    egg.pos.lerpVectors(egg.prev, egg.slot, e);
    egg.pos.y += Math.sin(e * Math.PI) * 0.03;
    egg.mesh.position.copy(egg.pos);
    egg.mesh.rotation.set(0, 0, 0);
    egg.body?.setNextKinematicTranslation({ x: egg.pos.x, y: egg.pos.y, z: egg.pos.z });
    if (egg.returnT >= 1) { egg.state = 'carton'; egg.prevDist = Infinity; }
  }

  private distToBowl(p: THREE.Vector3) {
    return Math.hypot(p.x - this.k.bowl.center.x, p.z - this.k.bowl.center.z);
  }

  // ---- cracking --------------------------------------------------------------

  private crack(egg: Egg, at: THREE.Vector3, inward: THREE.Vector3 | null) {
    if (egg.state === 'cracked') return;
    egg.state = 'cracked';
    egg.mesh.visible = false;
    if (egg.body) this.k.world.removeRigidBody(egg.body);
    egg.body = null;
    egg.collider = null;
    if (this.held === egg) this.held = null;

    sound.play('crack');
    const bowl = this.k.bowl;
    const away = new THREE.Vector3(at.x - bowl.center.x, 0, at.z - bowl.center.z).normalize();
    if (!isFinite(away.x)) away.set(0, 0, 1);
    const side = new THREE.Vector3(-away.z, 0, away.x);

    // Two shell halves fly apart, land on the counter and fade.
    this.spawnShell(this.shellTopGeo, at.clone().add(new THREE.Vector3(0, 0.012, 0)),
      away.clone().multiplyScalar(0.55).add(side.clone().multiplyScalar(0.18)).add(new THREE.Vector3(0, 0.85, 0)));
    this.spawnShell(this.shellBottomGeo, at.clone().add(new THREE.Vector3(0, -0.012, 0)),
      away.clone().multiplyScalar(0.45).sub(side.clone().multiplyScalar(0.18)).add(new THREE.Vector3(0, 0.6, 0)));

    // The yolk drops into the bowl.
    const yolkPos = inward ? at.clone().addScaledVector(inward, 0.04).add(new THREE.Vector3(0, -0.01, 0)) : at.clone();
    const yolkVel = inward ? inward.clone().multiplyScalar(0.12).add(new THREE.Vector3(0, -0.15, 0)) : new THREE.Vector3(egg.vel.x, Math.min(egg.vel.y, 0), egg.vel.z);
    this.spawnYolk(yolkPos, yolkVel);

    this.cracked++;
    this.events.onProgress(this.cracked, this.total);
  }

  private spawnShell(geo: THREE.BufferGeometry, pos: THREE.Vector3, vel: THREE.Vector3) {
    const k = this.k;
    const mat = new THREE.MeshStandardMaterial({ color: P.shell, roughness: 0.55, side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    k.scene.add(mesh);
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.4).setAngularDamping(1.5));
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 12 }, true);
    const collider = k.world.createCollider(
      RAPIER.ColliderDesc.ball(0.012).setRestitution(0.3).setFriction(0.9).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.debris.push({ mesh, body, collider, age: 0, landed: false, squish: 0, kind: 'shell' });
  }

  private spawnYolk(pos: THREE.Vector3, vel: THREE.Vector3) {
    const k = this.k;
    const mesh = new THREE.Mesh(this.yolkGeo, this.yolkMat);
    mesh.castShadow = true;
    k.scene.add(mesh);
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(1.2).setAngularDamping(3));
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    const collider = k.world.createCollider(
      RAPIER.ColliderDesc.ball(0.014).setRestitution(0.02).setFriction(1).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.debris.push({ mesh, body, collider, age: 0, landed: false, squish: 0, kind: 'yolk' });
  }

  private updateDebris(d: Debris, dt: number) {
    d.age += dt;
    const p = d.body.translation();
    const q = d.body.rotation();
    d.mesh.position.set(p.x, p.y, p.z);
    d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    if (d.kind === 'yolk') {
      // A yolk sits a little flattened, and squishes on landing.
      d.squish = Math.max(0, d.squish - dt * 4);
      const s = Math.sin(Math.min(1, d.squish) * Math.PI) * 0.35;
      d.mesh.quaternion.identity();
      d.mesh.scale.set(1 + s, 0.78 - s * 0.6, 1 + s);
    } else if (d.age > 2.4) {
      (d.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - (d.age - 2.4) / 0.6);
    }
  }

  private removeDebris(d: Debris) {
    this.k.world.removeRigidBody(d.body);
    this.k.scene.remove(d.mesh);
    if (d.kind === 'shell') (d.mesh.material as THREE.Material).dispose();
  }

  private onCollision(a: RAPIER.Collider, b: RAPIER.Collider) {
    const egg = this.eggs.find((e) => e.state === 'falling' && (e.collider === a || e.collider === b));
    if (egg) this.crack(egg, egg.pos.clone(), null);

    const d = this.debris.find((x) => !x.landed && (x.collider === a || x.collider === b));
    if (!d) return;
    d.landed = true;
    if (d.kind === 'yolk') {
      d.squish = 1;
      sound.play('plop', { gain: 0.8 });
      const local = this.pool.worldToLocal(d.mesh.position.clone());
      this.ripples.push({ x: local.x, y: local.y, t: 0 });
      this.landed++;
      if (this.landed >= this.total && !this.done) {
        this.done = true;
        this.events.onDone();
      }
    } else {
      sound.play('clink', { gain: 0.6 });
    }
  }

  // ---- the white pooling in the bowl -----------------------------------------

  private updatePool(dt: number) {
    const target = this.landed === 0 ? 0 : 0.45 + 0.55 * (this.landed / this.total);
    this.poolScale += (target - this.poolScale) * (1 - Math.exp(-4 * dt));
    this.pool.visible = this.poolScale > 0.01;
    if (!this.pool.visible) return;
    this.pool.scale.setScalar(this.poolScale);

    for (const r of this.ripples) r.t += dt;
    this.ripples = this.ripples.filter((r) => r.t < 1.8);
    const pos = this.pool.geometry.attributes.position as THREE.BufferAttribute;
    const base = this.poolBase;
    const s = this.poolScale;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      let z = 0;
      for (const r of this.ripples) {
        const d = Math.hypot(x * s - r.x, y * s - r.y);
        const front = 0.12 * r.t + 0.012;
        if (d < front) z += 0.0035 * Math.exp(-2.6 * r.t) * Math.sin(180 * d - 22 * r.t) * (1 - d / front);
      }
      pos.setZ(i, z / Math.max(s, 0.01));
    }
    pos.needsUpdate = true;
    if (this.ripples.length) this.pool.geometry.computeVertexNormals();
  }
}

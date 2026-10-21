// Step: crack the eggs. Pick an egg out of the carton, knock it on the rim of the
// bowl (or drop it in) and the shell splits, the yolk plops in and the white pools.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { P, SLOT } from '../kitchen';
import { sound } from '../sound';
import type { PointerHandler } from '../input';
import type { StepContext, StepRunner } from './step';

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

export class EggStep implements StepRunner, PointerHandler {
  readonly total = 3;
  cracked = 0;
  landed = 0;
  private finished = false;
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
  private readonly carton = new THREE.Group();
  private cartonBody: RAPIER.RigidBody | null = null;
  private readonly collisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => this.onCollision(a, b);

  constructor(private readonly ctx: StepContext) {
    this.holdY = ctx.bowl.home.y + ctx.bowl.rimY + EGG_H + 0.004;
  }

  start() {
    const { k, hud, station } = this.ctx;
    const cartonPos = k.at(SLOT.front, station); // the pan has left; the carton has the front slot to itself
    this.addCarton(cartonPos);
    for (let i = 0; i < this.total; i++) this.eggs.push(this.makeEgg(new THREE.Vector3(cartonPos.x + (i - 1) * 0.062, 0.03 + EGG_H - 0.012, cartonPos.z)));
    k.pointer.handlers.unshift(this);
    k.onCollision.add(this.collisionHandler);
    hud.meter('pips');
    hud.setPips(this.total, 0);
  }

  /** World points a test driver can aim at. */
  targets() {
    const { bowl } = this.ctx;
    const dir = new THREE.Vector3(0, 0, 1); // the rim nearest the camera
    const at = (r: number) => bowl.home.clone().addScaledVector(dir, r).setY(this.holdY);
    const out: Record<string, THREE.Vector3> = { outside: at(bowl.rimRadius + 0.06), inside: at(bowl.rimRadius - 0.06), center: at(0) };
    this.eggs.forEach((e, i) => { out[`egg${i}`] = e.pos.clone(); });
    out.pan = this.ctx.pan.position.clone(); // parked off screen; the driver checks it stays clear of the eggs
    return out;
  }

  /** The carton and the uncracked eggs, for the test driver's overlap checks. */
  boxes() {
    const out: Record<string, THREE.Object3D> = { carton: this.carton };
    this.eggs.forEach((e, i) => { if (e.state !== 'cracked') out[`egg${i}`] = e.mesh; });
    return out;
  }

  // ---- building ------------------------------------------------------------

  private addCarton(at: THREE.Vector3) {
    const { k } = this.ctx;
    this.carton.position.copy(at);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.075), new THREE.MeshStandardMaterial({ color: 0xffcdd5, roughness: 0.95 }));
    base.position.y = 0.015;
    base.castShadow = true;
    base.receiveShadow = true;
    this.carton.add(base);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xf7b9c4, roughness: 0.95 });
    for (let i = -1; i <= 1; i++) {
      const cup = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.006, 10, 28), cupMat);
      cup.rotation.x = Math.PI / 2;
      cup.position.set(i * 0.062, 0.03, 0);
      cup.castShadow = true;
      this.carton.add(cup);
    }
    k.scene.add(this.carton);
    this.cartonBody = k.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(at.x, 0.015, at.z));
    k.world.createCollider(RAPIER.ColliderDesc.cuboid(0.105, 0.015, 0.0375), this.cartonBody);
  }

  private makeEgg(slot: THREE.Vector3): Egg {
    const { k } = this.ctx;
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

  down(x: number, y: number) {
    if (this.held || this.finished) return false;
    this.pointer = { x, y };
    let best: Egg | null = null;
    let bestD = GRAB_PX;
    for (const egg of this.eggs) {
      if (egg.state !== 'carton' && egg.state !== 'returning') continue;
      const d = this.ctx.k.screenDist(x, y, egg.pos);
      if (d < bestD) { bestD = d; best = egg; }
    }
    if (!best) return false;
    best.state = 'held';
    best.prevDist = this.distToBowl(best.pos);
    this.held = best;
    return true;
  }

  move(x: number, y: number) { this.pointer = { x, y }; }

  up() {
    const egg = this.held;
    if (!egg) return;
    this.held = null;
    if (egg.state !== 'held') return;
    const over = this.distToBowl(egg.pos) < this.ctx.bowl.rimRadius - 0.03;
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

  update(dt: number, t: number) {
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
  }

  private updateHeld(egg: Egg, dt: number, t: number) {
    const { k, bowl } = this.ctx;
    const target = k.fingerAt(this.pointer.x, this.pointer.y, this.holdY);
    if (target) {
      target.x = THREE.MathUtils.clamp(target.x, bowl.home.x - 0.3, bowl.home.x + 0.3);
      target.z = THREE.MathUtils.clamp(target.z, -0.32, 0.3);
      egg.pos.lerp(target, 1 - Math.exp(-20 * dt));
    }
    egg.vel.subVectors(egg.pos, egg.prev).divideScalar(Math.max(dt, 1e-3));
    egg.prev.copy(egg.pos);

    // Crossing the rim band fast enough knocks the shell; slowly just touches it.
    const d = this.distToBowl(egg.pos);
    const rim = bowl.rimRadius;
    const enteredFromOutside = egg.prevDist > rim + RIM_BAND.outer && d <= rim + RIM_BAND.outer;
    const enteredFromInside = egg.prevDist < rim - RIM_BAND.inner && d >= rim - RIM_BAND.inner;
    egg.prevDist = d;
    if (enteredFromOutside || enteredFromInside) {
      const speed = Math.hypot(egg.vel.x, egg.vel.z);
      if (speed > KNOCK_SPEED) {
        const inward = new THREE.Vector3(bowl.home.x - egg.pos.x, 0, bowl.home.z - egg.pos.z).normalize();
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
    if (p.y < this.ctx.bowl.home.y + this.ctx.bowl.floorY - 0.03) this.crack(egg, egg.pos.clone(), null);
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
    return Math.hypot(p.x - this.ctx.bowl.home.x, p.z - this.ctx.bowl.home.z);
  }

  // ---- cracking --------------------------------------------------------------

  private crack(egg: Egg, at: THREE.Vector3, inward: THREE.Vector3 | null) {
    if (egg.state === 'cracked') return;
    egg.state = 'cracked';
    egg.mesh.visible = false;
    if (egg.body) this.ctx.k.world.removeRigidBody(egg.body);
    egg.body = null;
    egg.collider = null;
    if (this.held === egg) this.held = null;

    sound.play('crack');
    const bowl = this.ctx.bowl;
    const away = new THREE.Vector3(at.x - bowl.home.x, 0, at.z - bowl.home.z).normalize();
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
    this.ctx.hud.setPips(this.total, this.cracked);
    this.ctx.hud.hint(this.cracked === 1 ? 'Lovely! Two more.' : this.cracked === 2 ? 'One more!' : 'All in!');
  }

  private spawnShell(geo: THREE.BufferGeometry, pos: THREE.Vector3, vel: THREE.Vector3) {
    const { k } = this.ctx;
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
    const { k } = this.ctx;
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
    this.ctx.k.world.removeRigidBody(d.body);
    this.ctx.k.scene.remove(d.mesh);
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
      this.ctx.bowl.ripple(d.mesh.position);
      this.landed++;
      if (this.landed >= this.total && !this.finished) {
        this.finished = true;
        this.ctx.done();
      }
    } else {
      sound.play('clink', { gain: 0.6 });
    }
  }

  dispose() {
    const { k, leftovers } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    k.onCollision.delete(this.collisionHandler);
    for (const egg of this.eggs) { if (egg.body) k.world.removeRigidBody(egg.body); k.scene.remove(egg.mesh); }
    for (const d of this.debris) {
      if (d.kind === 'shell') this.removeDebris(d);
      else leftovers.push({ mesh: d.mesh, body: d.body }); // yolks stay in the bowl until the recipe ends
    }
    k.scene.remove(this.carton);
    if (this.cartonBody) k.world.removeRigidBody(this.cartonBody);
  }
}

// Step: crack the eggs. Pick an egg out of the carton, knock it on the rim of the
// bowl (or drop it in) and the shell splits, the yolk plops in and the white pools.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { P, SLOT } from '../kitchen';
import { Lean, GRAB_OFFSET_DECAY } from '../gestures';
import { motion, Spring3, easeOutBack, easeOutCubic } from '../motion';
import { sound } from '../sound';
import type { PointerHandler } from '../input';
import type { StepContext, StepRunner } from './step';

const EGG_R = 0.021;            // half width
const EGG_H = EGG_R * 1.33;     // half height
const KNOCK_SPEED = 0.35;       // m/s across the rim to crack
const GRAB_PX = 56;             // how close a finger must be to an egg, in CSS pixels
const RIM_BAND = { inner: 0.025, outer: 0.015 };
const RETURN_T = 0.35;          // s back to its cup after a let-go away from the bowl
const CUP_WOBBLE = 0.14;        // rad: it rocks in its cup when it gets back (more than a pan does on the counter)
const CARRY_CLEAR = 0.006;      // m the carried egg's bottom clears the rim while it is not over it
const RIM_PRESS = 0.0015;       // m it sinks into the rim's top as it rests on it, so it visibly touches (by eye)
const RIM_WIDTH = 0.0085;       // m, the flat top of the bowl's rim (bowl.ts: 0.125-0.135 x SIZE)
const AT_RIM = 0.004;           // m: this close to resting on the rim counts as touching it
// Where a shell half may come down, relative to the Station: in view on a phone, clear of the
// carton at the front slot and of the hint pill below it.
const SHELL_ZONE = { x0: -0.115, x1: 0.125, z0: -0.2, z1: 0.075 };
/** A landed shell half rocks for this long (s), then fades out over t. */
const SHELL_FADE = { at: 0.9, t: 0.5 };
const YOLK_FULL_SPEED = 0.6;    // m/s a yolk lands at for a full plop (slower is softer)
const MASS = 0.06;              // kg in the hand

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
  /** Follows the finger a touch behind, like everything carried (tuned by eye, as Carry). */
  follow: Spring3;
  lean: Lean;
}

interface Debris {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  age: number;
  landed: boolean;
  /** s since a shell half landed: it rocks to a stop, then fades. */
  rest: number;
  squish: number;
  kind: 'shell' | 'yolk';
  /** m/s last frame: the speed it hits with, read before the collision changes it. */
  speed: number;
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
  /** Lifted straight up, not toward the camera (see GRAB_OFFSET_DECAY). */
  private readonly grabOff = new THREE.Vector3();
  private readonly travel = new THREE.Vector3();
  private readonly holdY: number;
  private readonly eggGeo = eggGeometry(EGG_R);
  private readonly shellTopGeo = eggGeometry(EGG_R, 0, Math.PI / 2);
  private readonly shellBottomGeo = eggGeometry(EGG_R, Math.PI / 2, Math.PI / 2);
  /** The halves' colliders: their own convex shape, so a half rocks on its dome instead of rolling like a marble. */
  private readonly shellTopHull = (this.shellTopGeo.attributes.position as THREE.BufferAttribute).array as Float32Array;
  private readonly shellBottomHull = (this.shellBottomGeo.attributes.position as THREE.BufferAttribute).array as Float32Array;
  private readonly eggMat = new THREE.MeshStandardMaterial({ color: P.shell, roughness: 0.55 });
  private readonly yolkGeo = new THREE.SphereGeometry(0.016, 24, 16);
  private readonly yolkMat = new THREE.MeshStandardMaterial({ color: P.yolk, roughness: 0.3 });
  private readonly carton = new THREE.Group();
  private cartonBody: RAPIER.RigidBody | null = null;
  private batterFloor: RAPIER.RigidBody | null = null;
  private batterCollider: RAPIER.Collider | null = null;
  private readonly collisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => this.onCollision(a, b);

  private readonly rimTop: number;
  /** The held egg came into the rim band slowly and has not touched the rim yet. */
  private rimPending = false;

  constructor(private readonly ctx: StepContext) {
    this.rimTop = ctx.bowl.home.y + ctx.bowl.rimY;
    this.holdY = this.rimTop + EGG_H + CARRY_CLEAR;
  }

  /**
   * How high the egg's middle sits when it rests on the rim at this distance from the bowl's
   * axis (its curved underside on the rim's flat top), or null when it is not over the rim.
   */
  private rimContactY(d: number) {
    const outer = this.ctx.bowl.rimRadius, inner = outer - RIM_WIDTH;
    const h = d > outer ? d - outer : d < inner ? inner - d : 0; // from the egg's middle to the nearest bit of rim
    if (h >= EGG_R * 0.95) return null;
    return this.rimTop + EGG_H * Math.sqrt(1 - (h / EGG_R) ** 2) - RIM_PRESS;
  }

  /** The carried height: clear of the rim, settling onto it as the egg comes over it. */
  private carryY(d: number) {
    const c = this.rimContactY(d);
    if (c === null) return this.holdY;
    const outer = this.ctx.bowl.rimRadius, inner = outer - RIM_WIDTH;
    const h = d > outer ? d - outer : d < inner ? inner - d : 0;
    // over the rim it comes down onto it (the spring makes that a soft settle, not a snap)
    return this.holdY + (c - this.holdY) * (1 - THREE.MathUtils.smoothstep(h, EGG_R * 0.8, EGG_R * 0.95));
  }

  start() {
    const { k, hud, station } = this.ctx;
    const cartonPos = k.at(SLOT.front, station); // the pan has left; the carton has the front slot to itself
    this.addCarton(cartonPos);
    const arrive: Promise<void>[] = [motion.popIn(this.carton, 0.28)];
    // The yolks settle on the batter, not under it: a thin invisible floor just below its surface.
    const { bowl } = this.ctx;
    this.batterFloor = k.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bowl.home.x, bowl.surfaceY() - 0.007, bowl.home.z));
    this.batterCollider = k.world.createCollider(RAPIER.ColliderDesc.cylinder(0.003, Math.max(0.03, bowl.surfaceRadius() - 0.012)).setFriction(1), this.batterFloor);
    for (let i = 0; i < this.total; i++) {
      const egg = this.makeEgg(new THREE.Vector3(cartonPos.x + (i - 1) * 0.062, 0.03 + EGG_H - 0.012, cartonPos.z));
      this.eggs.push(egg);
      // the eggs pop into their cups one after another, as the carton lands
      egg.mesh.visible = false;
      arrive.push(motion.delay(0.1 + i * 0.06).then(() => motion.popIn(egg.mesh, 0.26)));
    }
    k.pointer.handlers.unshift(this);
    k.onCollision.add(this.collisionHandler);
    hud.meter('pips');
    hud.setPips(this.total, 0);
    return Promise.all(arrive).then(() => {});
  }

  /** World points a test driver can aim at. */
  targets() {
    const { bowl } = this.ctx;
    const dir = new THREE.Vector3(0, 0, 1); // the rim nearest the camera
    const at = (r: number) => bowl.home.clone().addScaledVector(dir, r).setY(this.holdY);
    const out: Record<string, THREE.Vector3> = { outside: at(bowl.rimRadius + 0.06), inside: at(bowl.rimRadius - 0.06), center: at(0) };
    // resting on the near rim (a slow drag there touches it: a tap, no crack)
    out.rim = at(bowl.rimRadius + 0.004);
    this.eggs.forEach((e, i) => {
      out[`egg${i}`] = e.pos.clone();
      // just outside the rim on this egg's side: carrying it there is carrying it straight at the bowl
      const away = new THREE.Vector3(e.slot.x - bowl.home.x, 0, e.slot.z - bowl.home.z).normalize();
      out[`toward${i}`] = bowl.home.clone().addScaledVector(away, bowl.rimRadius + 0.06).setY(this.holdY);
    });
    out.pan = this.ctx.pan.position.clone(); // parked off screen; the driver checks it stays clear of the eggs
    return out;
  }

  /** The finger cue goes on the first egg still in the carton. */
  cue() {
    const i = this.eggs.findIndex((e) => e.state === 'carton');
    return i < 0 ? null : { name: `egg${i}`, at: this.eggs[i].pos.clone() };
  }

  /** How far the egg in the hand leans, and how much of that is toward the bowl (rad), for the test driver. */
  debug() {
    const h = this.held;
    let toward = 0, into = 0, heading = 0;
    if (h) {
      // the top tips toward (-rotation.z, rotation.x) in (x, z)
      const { bowl } = this.ctx;
      const tx = -h.mesh.rotation.z, tz = h.mesh.rotation.x;
      const dx = bowl.home.x - h.pos.x, dz = bowl.home.z - h.pos.z, d = Math.hypot(dx, dz) || 1;
      toward = (tx * dx + tz * dz) / d;
      const v = h.lean.vel, s = Math.hypot(v.x, v.z) || 1;
      into = (tx * v.x + tz * v.z) / s;
      heading = (v.x * dx + v.z * dz) / (s * d);
    }
    // how far the held egg's underside is above the rim it is over (m; null when not over it)
    const c = h ? this.rimContactY(this.distToBowl(h.pos)) : null;
    const eggOverRim = h && c !== null ? h.pos.y - (c + RIM_PRESS) : null;
    return { eggLean: h ? h.lean.amount : 0, eggToward: toward, eggIntoTravel: into, eggHeading: heading, cracked: this.cracked, eggOverRim, eggHeld: !!h };
  }

  /** The carton and the uncracked eggs, for the test driver's overlap checks. */
  focus() { return this.held?.mesh ?? null; }

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
    return {
      mesh, body, collider, slot: slot.clone(), pos: slot.clone(), prev: slot.clone(), vel: new THREE.Vector3(), state: 'carton', prevDist: Infinity, returnT: 0,
      // an egg is light and quick in the hand: it leans three times as far as a pan for the same speed (tuned by eye)
      follow: new Spring3(slot, 220, 0.9), lean: new Lean(1.8, 0.55),
    };
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
    if (best.state === 'carton') best.lean.reset();
    best.state = 'held';
    best.follow.jump(best.pos);
    const f = this.ctx.k.fingerAt(x, y, this.holdY);
    this.grabOff.set(f ? best.pos.x - f.x : 0, 0, f ? best.pos.z - f.z : 0);
    best.prevDist = this.distToBowl(best.pos);
    this.held = best;
    sound.play('grab', { gain: 0.15 + MASS * 0.5, rate: 1.3 }); // light: a little shell-and-cardboard lift
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
    // the cat watches the egg in the hand
    if (this.held) this.ctx.cat.leanTo(this.held.pos, 0.5);
    for (const egg of this.eggs) {
      switch (egg.state) {
        case 'held': this.updateHeld(egg, dt, t); break;
        case 'falling': this.updateFalling(egg); break;
        case 'returning': this.updateReturning(egg, dt); break;
        case 'carton':
          // still rocking in its cup from being put back; otherwise at rest
          if (egg.lean.settling || egg.lean.amount > 1e-4) { egg.lean.step(dt, null); egg.lean.apply(egg.mesh); }
          break;
      }
    }
    for (const d of this.debris) this.updateDebris(d, dt);
    this.debris = this.debris.filter((d) => {
      if (d.kind === 'shell' && (d.rest > SHELL_FADE.at + SHELL_FADE.t || d.age > 3)) { this.removeDebris(d); return false; }
      return true;
    });
  }

  private updateHeld(egg: Egg, dt: number, t: number) {
    const { k, bowl } = this.ctx;
    const target = k.fingerAt(this.pointer.x, this.pointer.y, this.holdY);
    this.grabOff.multiplyScalar(Math.exp(-GRAB_OFFSET_DECAY * dt));
    if (target) {
      target.add(this.grabOff);
      target.x = THREE.MathUtils.clamp(target.x, bowl.home.x - 0.3, bowl.home.x + 0.3);
      target.z = THREE.MathUtils.clamp(target.z, -0.32, 0.3);
      target.y = this.carryY(this.distToBowl(target));
      egg.follow.set(target);
    }
    egg.follow.step(dt);
    egg.pos.copy(egg.follow.value);
    egg.vel.copy(egg.follow.velocity);
    egg.prev.copy(egg.pos);
    // it leans with the hand's travel, not with the settling under the finger
    egg.lean.step(dt, this.travel.copy(egg.vel).addScaledVector(this.grabOff, GRAB_OFFSET_DECAY));

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
      this.rimPending = true; // a slow pass: it taps once the shell is really down on the rim
    }
    // The tap is the shell meeting the rim, as loud as it comes down on it; then it rests there.
    const inBand = d <= rim + RIM_BAND.outer && d >= rim - RIM_BAND.inner;
    if (!inBand) this.rimPending = false;
    const c = this.rimContactY(d);
    if (this.rimPending && c !== null && egg.pos.y - c < AT_RIM) {
      this.rimPending = false;
      sound.play('tap', { gain: THREE.MathUtils.clamp(egg.vel.length() * 1.6, 0.08, 0.6) });
    }

    egg.mesh.position.copy(egg.pos);
    egg.lean.apply(egg.mesh, Math.sin(t * 9) * 0.03, Math.cos(t * 7) * 0.03);
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

  /** Back to its cup with a little overshoot, the lean springing upright, then a rock in the cup. */
  private updateReturning(egg: Egg, dt: number) {
    egg.returnT = Math.min(1, egg.returnT + dt / RETURN_T);
    const u = egg.returnT;
    egg.pos.lerpVectors(egg.prev, egg.slot, easeOutBack(u));
    egg.pos.y = egg.prev.y + (egg.slot.y - egg.prev.y) * easeOutCubic(u) + Math.sin(u * Math.PI) * 0.03;
    egg.mesh.position.copy(egg.pos);
    egg.lean.step(dt, null);
    egg.lean.apply(egg.mesh);
    egg.body?.setNextKinematicTranslation({ x: egg.pos.x, y: egg.pos.y, z: egg.pos.z });
    if (u >= 1) {
      egg.state = 'carton';
      egg.prevDist = Infinity;
      egg.pos.copy(egg.slot);
      egg.lean.wobble(CUP_WOBBLE);
      sound.play('drop', { gain: 0.2, rate: 1.5 }); // back in its paper cup: a light, dull knock
    }
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

    // The shell crunches and the white slops off 30 ms later, quietly; the yolk's plop follows
    // when it lands. Nothing else: a stack of clinks and tinks reads as clutter, not an egg.
    sound.play('crack');
    sound.play('slop', { gain: 0.25, delay: 0.03 });
    const bowl = this.ctx.bowl;
    const away = new THREE.Vector3(at.x - bowl.home.x, 0, at.z - bowl.home.z).normalize();
    if (!isFinite(away.x)) away.set(0, 0, 1);
    const side = new THREE.Vector3(-away.z, 0, away.x);

    // Two shell halves fly apart sideways along the rim (straight out from the bowl is where
    // the carton sits), land on the counter, rock to a stop and fade.
    const topAt = at.clone().add(new THREE.Vector3(0, 0.012, 0)), bottomAt = at.clone().add(new THREE.Vector3(0, -0.012, 0));
    this.spawnShell(this.shellTopGeo, this.shellTopHull, topAt,
      this.onCounter(topAt, side.clone().multiplyScalar(0.5).add(away.clone().multiplyScalar(0.12)).add(new THREE.Vector3(0, 0.85, 0))));
    this.spawnShell(this.shellBottomGeo, this.shellBottomHull, bottomAt,
      this.onCounter(bottomAt, side.clone().multiplyScalar(-0.42).add(away.clone().multiplyScalar(0.1)).add(new THREE.Vector3(0, 0.6, 0))));

    // The yolk drops into the bowl.
    // (5 cm in from the knock: clear of the bowl's wall, so it drops straight onto the batter)
    const yolkPos = inward ? at.clone().addScaledVector(inward, 0.05).add(new THREE.Vector3(0, -0.01, 0)) : at.clone();
    const yolkVel = inward ? inward.clone().multiplyScalar(0.12).add(new THREE.Vector3(0, -0.15, 0)) : new THREE.Vector3(egg.vel.x, Math.min(egg.vel.y, 0), egg.vel.z);
    this.spawnYolk(yolkPos, yolkVel);

    this.cracked++;
    this.ctx.hud.setPips(this.total, this.cracked);
    this.ctx.hud.hint(this.cracked === 1 ? 'Lovely! Two more.' : this.cracked === 2 ? 'One more!' : 'All in!');
  }

  /**
   * Trim a shell half's throw so it comes down where it can be seen: on the counter inside the
   * phone's view, behind the carton and above the hint at the bottom of the screen (tuned by eye).
   */
  private onCounter(from: THREE.Vector3, vel: THREE.Vector3) {
    const g = 9.81, landY = 0.012; // the half's ball resting on the counter top (y = 0)
    const t = (vel.y + Math.sqrt(vel.y * vel.y + 2 * g * Math.max(0, from.y - landY))) / g;
    const sx = this.ctx.station;
    const x = THREE.MathUtils.clamp(from.x + vel.x * t, sx + SHELL_ZONE.x0, sx + SHELL_ZONE.x1);
    const z = THREE.MathUtils.clamp(from.z + vel.z * t, SHELL_ZONE.z0, SHELL_ZONE.z1);
    return vel.set((x - from.x) / t, vel.y, (z - from.z) / t);
  }

  private spawnShell(geo: THREE.BufferGeometry, hull: Float32Array, pos: THREE.Vector3, vel: THREE.Vector3) {
    const { k } = this.ctx;
    const mat = new THREE.MeshStandardMaterial({ color: P.shell, roughness: 0.55, side: THREE.DoubleSide, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    k.scene.add(mesh);
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setLinearDamping(0.4).setAngularDamping(1.5));
    body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    body.setAngvel({ x: (Math.random() - 0.5) * 12, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 12 }, true);
    const collider = k.world.createCollider(
      (RAPIER.ColliderDesc.convexHull(hull) ?? RAPIER.ColliderDesc.ball(0.012)).setRestitution(0.2).setFriction(0.9).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      body,
    );
    this.debris.push({ mesh, body, collider, age: 0, landed: false, rest: 0, squish: 0, kind: 'shell', speed: 0 });
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
    this.debris.push({ mesh, body, collider, age: 0, landed: false, rest: 0, squish: 0, kind: 'yolk', speed: 0 });
  }

  private updateDebris(d: Debris, dt: number) {
    d.age += dt;
    const p = d.body.translation();
    const q = d.body.rotation();
    d.mesh.position.set(p.x, p.y, p.z);
    d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    const v = d.body.linvel();
    d.speed = Math.hypot(v.x, v.y, v.z);
    if (d.kind === 'yolk') {
      // On the batter (or, should it ever hang on the wall, after a second and a half) it has landed.
      if (!d.landed && ((d.age > 0.03 && p.y < this.ctx.bowl.surfaceY() + 0.012) || d.age > 1.5)) this.yolkLanded(d);
      // A yolk sits a little flattened, and squishes on landing.
      d.squish = Math.max(0, d.squish - dt * 4);
      const s = Math.sin(Math.min(1, d.squish) * Math.PI) * 0.35;
      d.mesh.quaternion.identity();
      d.mesh.scale.set(1 + s, 0.78 - s * 0.6, 1 + s);
    } else {
      if (d.landed) d.rest += dt;
      const fade = Math.max((d.rest - SHELL_FADE.at) / SHELL_FADE.t, (d.age - 2.4) / 0.6);
      if (fade > 0) (d.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 1 - fade);
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
    const other = d.collider === a ? b : a;
    if (d.kind === 'yolk') {
      // only the batter is a landing; brushing the wall on the way down is not
      if (this.batterCollider && other.handle === this.batterCollider.handle) this.yolkLanded(d);
      return;
    }
    // (the halves start out touching the rim and each other: only a later hit is a landing)
    if (d.age < 0.08) return;
    d.landed = true;
    // a shell half on the wooden counter gives one tiny dull tick; on the bowl or the batter it is lost under the plop
    if (this.isCounter(other)) sound.play('tink', { gain: 0.08, rate: 0.7 });
  }

  private yolkLanded(d: Debris) {
    d.landed = true;
    d.squish = 1;
    // as loud as it lands hard: the speed from the frame before the hit (Rapier has already slowed it)
    sound.play('plop', { gain: THREE.MathUtils.clamp(d.speed / YOLK_FULL_SPEED, 0.15, 1) });
    this.ctx.bowl.ripple(d.mesh.position);
    this.landed++;
    if (this.landed >= this.total && !this.finished) {
      this.finished = true;
      this.ctx.done();
    }
  }

  /** The counter top: the Kitchen's one big fixed slab (kitchen.ts), 3.6 m long. */
  private isCounter(c: RAPIER.Collider) {
    if (!c.parent()?.isFixed() || c.shape.type !== RAPIER.ShapeType.Cuboid) return false;
    return (c.shape as RAPIER.Cuboid).halfExtents.x > 1;
  }

  /** Once the last shells have landed (0.6 s at most), the carton and the shells pop away. */
  async leave() {
    for (let t = 0; t < 0.6 && this.debris.some((d) => d.kind === 'shell' && !d.landed); t += 1 / 60) await motion.delay(1 / 60);
    const outs = [motion.popOut(this.carton, 0.22)];
    for (const d of this.debris) if (d.kind === 'shell') outs.push(motion.popOut(d.mesh, 0.18));
    await Promise.all(outs);
    this.carton.visible = false;
  }

  dispose() {
    const { k } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    k.onCollision.delete(this.collisionHandler);
    for (const egg of this.eggs) { if (egg.body) k.world.removeRigidBody(egg.body); k.scene.remove(egg.mesh); }
    for (const d of this.debris) {
      if (d.kind === 'shell') { this.removeDebris(d); continue; }
      // Yolks stay in the bowl as decorations on the batter (the cream melts them in): no
      // more physics, and they ride with the bowl from here on.
      k.world.removeRigidBody(d.body);
      d.mesh.name = 'yolk';
      this.ctx.bowl.contents.attach(d.mesh);
    }
    k.scene.remove(this.carton);
    if (this.cartonBody) k.world.removeRigidBody(this.cartonBody);
    if (this.batterFloor) k.world.removeRigidBody(this.batterFloor);
  }
}

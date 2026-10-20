// Step: pour in the cream, then the flour, then the flavour's add-in. Press and hold
// anywhere: the current thing lifts over the bowl, tilts and pours while you hold.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SLOT } from '../kitchen';
import { HoldMeter } from '../gestures';
import { Stream } from '../stream';
import { makeJug, makeCup, makeBerryDish, makeLemon } from '../props';
import { sound, type Loop, type LoopName } from '../sound';
import type { PointerHandler } from '../input';
import { ease, type StepContext, type StepRunner } from './step';

interface Pourable {
  name: string;
  obj: THREE.Group;
  kind: 'liquid' | 'flour' | 'berries' | 'lemon';
  stream: number;      // colour
  radius: number;      // stream radius
  level: number;       // how much it raises the bowl
  loop: LoopName | null;
  spout: THREE.Vector3; // local point the pour leaves from
}

export class PourStep implements StepRunner, PointerHandler {
  private readonly items: Pourable[] = [];
  private index = 0;
  private readonly meter = new HoldMeter(1.8, [0.5, 0.85]);
  private holding = false;
  private lift = 0; // 0 = at rest, 1 = over the bowl
  private readonly stream: Stream;
  private loop: Loop | null = null;
  private rippleT = 0;
  private berryT = 0;
  private berries: { mesh: THREE.Mesh; body: RAPIER.RigidBody }[] = [];
  private floor: RAPIER.RigidBody | null = null;
  private startLevel = 0;
  private finished = false;
  private restPos = new THREE.Vector3();
  private readonly collisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => this.onCollision(a, b);
  private berryColliders = new Set<RAPIER.Collider>();

  constructor(private readonly ctx: StepContext) {
    this.stream = new Stream(ctx.k.scene, 0xfffaf2);
  }

  start() {
    const { k, bowl, hud, flavor, station } = this.ctx;
    this.restPos = k.at(SLOT.front, station);
    this.items.push(
      { name: 'cream', obj: makeJug(), kind: 'liquid', stream: 0xfffaf2, radius: 0.007, level: 0.018, loop: 'pour', spout: new THREE.Vector3(0.036, 0.085, 0) },
      { name: 'flour', obj: makeCup(), kind: 'flour', stream: 0xfffdf7, radius: 0.012, level: 0.01, loop: 'flour', spout: new THREE.Vector3(0.03, 0.058, 0) },
    );
    if (flavor.addIn === 'berries') this.items.push({ name: 'blueberries', obj: makeBerryDish(), kind: 'berries', stream: 0, radius: 0, level: 0.004, loop: null, spout: new THREE.Vector3(0.035, 0.03, 0) });
    if (flavor.addIn === 'lemon') this.items.push({ name: 'lemon', obj: makeLemon(), kind: 'lemon', stream: 0xfbf3a8, radius: 0.003, level: 0.004, loop: 'pour', spout: new THREE.Vector3(0, 0.032, 0) });
    for (const it of this.items) { it.obj.position.copy(this.restPos); it.obj.visible = false; k.scene.add(it.obj); }
    this.items[0].obj.visible = true;
    this.startLevel = bowl.level;
    k.pointer.handlers.unshift(this);
    k.onCollision.add(this.collisionHandler);
    hud.meter('ring');
    hud.setRing(0, this.meter.sweet);
    hud.setPips(this.items.length, 0);
    this.hintFor();
  }

  private get item() { return this.items[this.index]; }

  private hintFor() {
    const names: Record<string, string> = { cream: 'Hold to pour in the cream', flour: 'Hold to tip in the flour', blueberries: 'Hold to tumble in the blueberries', lemon: 'Hold to squeeze the lemon' };
    this.ctx.hud.hint(names[this.item.name]);
  }

  down() {
    if (this.finished) return false;
    this.holding = true;
    if (this.item.loop) this.loop ??= sound.loop(this.item.loop);
    return true;
  }

  move() {}

  up() {
    if (!this.holding) return;
    this.holding = false;
    this.loop?.set(0);
    if (this.meter.progress >= 0.25) this.next();
  }

  private next() {
    this.loop?.stop();
    this.loop = null;
    const result = this.meter.result();
    this.ctx.hud.setPips(this.items.length, this.index + 1);
    if (this.index + 1 >= this.items.length) { this.finished = true; this.ctx.done(result); return; }
    this.index++;
    this.meter.progress = 0;
    this.startLevel = this.ctx.bowl.level;
    this.item.obj.visible = true;
    this.hintFor();
  }

  update(dt: number, t: number) {
    const { k, bowl, hud } = this.ctx;
    const it = this.item;
    // Lift over the bowl while holding, settle back when not.
    this.lift += ((this.holding ? 1 : 0) - this.lift) * (1 - Math.exp(-9 * dt));
    const over = bowl.home.clone().add(new THREE.Vector3(0.07, bowl.rimY + 0.07, 0.04));
    for (const other of this.items) if (other !== it) other.obj.position.copy(this.restPos);
    it.obj.position.lerpVectors(this.restPos, over, ease(this.lift));
    const tilt = it.kind === 'lemon' ? 0 : -1.15 * ease(this.lift);
    it.obj.rotation.set(0, 0, tilt);
    if (it.kind === 'lemon') it.obj.rotation.x = Math.PI * ease(this.lift); // flip cut side down
    const pouring = this.holding && this.lift > 0.85 && !this.finished;

    if (pouring) {
      this.meter.advance(dt);
      const landing = bowl.home.clone().setY(bowl.surfaceY()).add(new THREE.Vector3(0.02, 0, 0.01));
      if (it.kind === 'berries') {
        this.berryT += dt;
        if (this.berryT > 0.16) { this.berryT = 0; this.dropBerry(it.obj.localToWorld(it.spout.clone())); }
      } else {
        this.stream.setColor(it.stream);
        this.stream.radius = it.radius;
        this.stream.flow = Math.min(1, this.stream.flow + dt * 6);
        this.stream.from.copy(it.obj.localToWorld(it.spout.clone()));
        this.stream.to.copy(landing);
        this.rippleT += dt;
        if (this.rippleT > 0.12) { this.rippleT = 0; bowl.ripple(landing, 0.7); }
      }
      bowl.setLevel(this.startLevel + it.level * Math.min(1, this.meter.progress * 1.3));
      this.loop?.set(1);
      if (it.kind === 'flour') bowl.setColor(0xfff7e4);
      if (it.kind === 'lemon') bowl.setColor(0xfbf0b0);
      if (this.meter.progress >= 1) { this.holding = false; this.loop?.set(0); this.next(); }
    } else {
      this.stream.flow = Math.max(0, this.stream.flow - dt * 10);
    }
    this.stream.update(t);
    hud.setRing(this.meter.progress, this.meter.sweet);
    for (const b of this.berries) {
      const p = b.body.translation();
      b.mesh.position.set(p.x, p.y, p.z);
    }
  }

  private dropBerry(at: THREE.Vector3) {
    const { k, bowl } = this.ctx;
    if (!this.floor) {
      // Berries bounce on the batter, so give the surface a thin invisible floor.
      this.floor = k.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(bowl.home.x, bowl.surfaceY() - 0.004, bowl.home.z));
      k.world.createCollider(RAPIER.ColliderDesc.cylinder(0.003, 0.11).setFriction(1.2), this.floor);
    }
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), new THREE.MeshStandardMaterial({ color: 0x5a4c9e, roughness: 0.5 }));
    mesh.castShadow = true;
    k.scene.add(mesh);
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setLinearDamping(0.8));
    body.setLinvel({ x: -0.15 + Math.random() * 0.1, y: -0.1, z: -0.08 + Math.random() * 0.1 }, true);
    const col = k.world.createCollider(RAPIER.ColliderDesc.ball(0.008).setRestitution(0.35).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    this.berryColliders.add(col);
    this.berries.push({ mesh, body });
  }

  private onCollision(a: RAPIER.Collider, b: RAPIER.Collider) {
    if (this.berryColliders.has(a) || this.berryColliders.has(b)) {
      sound.play('berry', { gain: 0.5 });
      const c = this.berryColliders.has(a) ? a : b;
      this.berryColliders.delete(c);
      const p = c.translation();
      this.ctx.bowl.ripple(new THREE.Vector3(p.x, p.y, p.z), 0.5);
    }
  }

  dispose() {
    const { k, leftovers } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    k.onCollision.delete(this.collisionHandler);
    for (const it of this.items) k.scene.remove(it.obj);
    this.stream.dispose(k.scene);
    this.loop?.stop();
    for (const b of this.berries) leftovers.push({ mesh: b.mesh, body: b.body });
    if (this.floor) leftovers.push({ mesh: new THREE.Object3D(), body: this.floor });
  }

  targets() {
    return { item: this.item.obj.position.clone(), anywhere: this.ctx.bowl.home.clone().setY(this.ctx.bowl.surfaceY()) };
  }
}

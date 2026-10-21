// Step: mix cream cheese and sugar. Circle a finger in the bowl; the whisk follows, the
// lumps melt away, the surface swirls. Stop in the sweet zone for "smooth".
import * as THREE from 'three';
import { HoldMeter, StirTracker } from '../gestures';
import { makeWhisk } from '../props';
import { sound, type Loop } from '../sound';
import type { PointerHandler } from '../input';
import type { StepContext, StepRunner } from './step';

const TURNS_NEEDED = 7;

export class StirStep implements StepRunner, PointerHandler {
  private readonly whisk = makeWhisk();
  private readonly lumps: THREE.Mesh[] = [];
  private readonly meter = new HoldMeter(1, [0.55, 0.85]);
  private readonly stir = new StirTracker();
  private holding = false;
  private pointer = { x: 0, y: 0 };
  private rippleT = 0;
  private loop: Loop | null = null;
  private finished = false;
  private dingDone = false;

  constructor(private readonly ctx: StepContext) {}

  start() {
    const { k, bowl, hud } = this.ctx;
    bowl.setLevel(0.02, true);
    bowl.setColor(0xfff3d6, true);
    const lumpMat = new THREE.MeshStandardMaterial({ color: 0xfff8e6, roughness: 0.9 });
    for (let i = 0; i < 7; i++) {
      const lump = new THREE.Mesh(new THREE.SphereGeometry(0.009 + Math.random() * 0.006, 12, 10), lumpMat);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.05;
      lump.position.set(Math.cos(a) * r, bowl.floorY + 0.02, Math.sin(a) * r);
      lump.castShadow = true;
      bowl.group.add(lump);
      this.lumps.push(lump);
    }
    this.whisk.position.copy(bowl.home).add(new THREE.Vector3(0.03, bowl.surfaceY() - bowl.home.y, 0.02));
    this.whisk.rotation.z = -0.3;
    k.scene.add(this.whisk);
    k.pointer.handlers.unshift(this);
    hud.meter('ring');
    hud.setRing(0, this.meter.sweet);
  }

  down(x: number, y: number) {
    if (this.finished) return false;
    const { k, bowl } = this.ctx;
    if (k.screenDist(x, y, bowl.home.clone().setY(bowl.surfaceY())) > 170) return false;
    this.holding = true;
    this.pointer = { x, y };
    this.loop ??= sound.loop('whisk');
    return true;
  }

  move(x: number, y: number) { this.pointer = { x, y }; }

  up() {
    this.holding = false;
    this.stir.lift();
    this.loop?.set(0);
    if (this.meter.progress >= 0.2) this.finish();
    else this.ctx.hud.hint('Keep going, round and round!');
  }

  update(dt: number, t: number) {
    const { k, bowl, hud } = this.ctx;
    const centre = k.toScreen(bowl.home.clone().setY(bowl.surfaceY()));
    if (this.holding && !this.finished) {
      this.stir.update(this.pointer.x, this.pointer.y, centre.x, centre.y, dt);
      this.meter.progress = Math.min(1, this.stir.turns / TURNS_NEEDED);
      const target = k.fingerAt(this.pointer.x, this.pointer.y, bowl.surfaceY());
      if (target) {
        const local = target.clone().sub(bowl.home);
        const r = Math.hypot(local.x, local.z);
        if (r > 0.085) { local.x *= 0.085 / r; local.z *= 0.085 / r; }
        this.whisk.position.lerp(bowl.home.clone().add(new THREE.Vector3(local.x, bowl.surfaceY() - bowl.home.y - 0.01, local.z)), 1 - Math.exp(-18 * dt));
      }
      this.rippleT += dt;
      if (this.rippleT > 0.09 && this.stir.speed > 1) {
        this.rippleT = 0;
        bowl.ripple(this.whisk.position, Math.min(1, this.stir.speed / 10));
      }
      bowl.spin = Math.min(3, this.stir.speed * 0.25);
      this.loop?.set(Math.min(1, this.stir.speed / 9));
      if (this.meter.inSweet && !this.dingDone) { this.dingDone = true; sound.play('ding', { gain: 0.6 }); }
      if (this.meter.progress >= 1) this.finish();
    } else {
      this.stir.decay(dt);
    }
    hud.setRing(this.meter.progress, this.meter.sweet);
    this.whisk.rotation.z = -0.3 + Math.sin(t * 20) * 0.08 * Math.min(1, this.stir.speed / 5);
    const smooth = this.meter.progress;
    for (const l of this.lumps) l.scale.setScalar(Math.max(0.001, 1 - smooth * 1.25));
    bowl.setColor(smooth > 0.5 ? 0xfff0c8 : 0xfff3d6);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.loop?.stop();
    this.loop = null;
    this.ctx.done(this.meter.result());
  }

  dispose() {
    const { k, bowl } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    k.scene.remove(this.whisk);
    for (const l of this.lumps) bowl.group.remove(l);
    this.loop?.stop();
    bowl.spin = 0;
  }

  targets() {
    const { bowl } = this.ctx;
    return { bowl: bowl.home.clone().setY(bowl.surfaceY()) };
  }

  progress() { return { progress: this.meter.progress, stage: this.finished ? 'done' : this.holding ? 'stirring' : 'idle' }; }

  meterInfo() { return { duration: this.meter.duration, sweet: this.meter.sweet }; }

  debug() { return { turns: this.stir.turns, stirSpeed: this.stir.speed, holding: this.holding }; }

  boxes() { return { whisk: this.whisk }; }
}

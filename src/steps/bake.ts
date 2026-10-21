// Step: bake it HOT. Drag the pan into the oven, then hold to bake while the top
// scorches through the window. The sweet spot is a burnt top: this is the key Step.
import * as THREE from 'three';
import { SLOT } from '../kitchen';
import { Carry, HoldMeter } from '../gestures';
import { sound, type Loop } from '../sound';
import type { PointerHandler } from '../input';
import { ease, type StepContext, type StepRunner } from './step';

const TOP_KEYS: [number, number][] = [[0, 0xfcebc4], [0.4, 0xe9c27a], [0.72, 0x5a3a28], [1, 0x30190f]];

function topColor(p: number) {
  for (let i = 1; i < TOP_KEYS.length; i++) {
    const [p0, c0] = TOP_KEYS[i - 1];
    const [p1, c1] = TOP_KEYS[i];
    if (p <= p1) return new THREE.Color(c0).lerp(new THREE.Color(c1), (p - p0) / (p1 - p0));
  }
  return new THREE.Color(TOP_KEYS[TOP_KEYS.length - 1][1]);
}

export class BakeStep implements StepRunner, PointerHandler {
  private phase: 'carry' | 'closing' | 'bake' | 'opening' | 'out' = 'carry';
  private carry!: Carry;
  private readonly meter = new HoldMeter(3.2, [0.6, 0.85]);
  private holding = false;
  private door!: THREE.Group;
  private light!: THREE.PointLight;
  private glass!: THREE.MeshStandardMaterial;
  private fill!: THREE.Mesh;
  private fillMat!: THREE.MeshStandardMaterial;
  private doorOpen = 0;
  private doorTarget = 0;
  private heat = 0;
  private loop: Loop | null = null;
  private animT = 0;
  private from = new THREE.Vector3();
  private inside = new THREE.Vector3();
  private outPos = new THREE.Vector3();
  private dingDone = false;
  private panArrived = false;
  private result: 'under' | 'right' | 'over' = 'right';

  constructor(private readonly ctx: StepContext) {}

  start() {
    const { k, pan, oven, hud, station } = this.ctx;
    this.door = oven.getObjectByName('door') as THREE.Group;
    this.light = oven.getObjectByName('light') as THREE.PointLight;
    this.glass = (oven.getObjectByName('glass') as THREE.Mesh).material as THREE.MeshStandardMaterial;
    this.fill = pan.getObjectByName('fill') as THREE.Mesh;
    this.fillMat = this.fill.material as THREE.MeshStandardMaterial;
    this.outPos = k.at(SLOT.front, station);
    this.inside = oven.position.clone().add(new THREE.Vector3(0, 0.038, 0.03));
    // The filled pan slides in from the Stove's park slot; it can be picked up once it is there.
    pan.position.copy(k.at(SLOT.park, station));
    pan.rotation.set(0, 0, 0);
    pan.visible = true;
    k.glide(pan, this.outPos, 0.5).then(() => {
      this.panArrived = true;
      if (this.phase === 'carry') k.pointer.handlers.unshift(this.carry);
    });
    this.carry = new Carry(k, [{ obj: pan, home: this.outPos.clone(), placed: false }], {
      holdY: 0.1,
      grabPx: 90,
      onGrab: () => { this.doorTarget = 1; sound.play('door', { gain: 0.6 }); },
      onDrop: (_item, pos) => {
        const mouth = oven.position.clone().add(new THREE.Vector3(0, 0, 0.15));
        if (Math.hypot(pos.x - mouth.x, pos.z - mouth.z) > 0.15) { this.doorTarget = 0; return false; }
        this.phase = 'closing';
        this.animT = 0;
        this.from.copy(pos);
        hud.hint('In it goes…');
        return true;
      },
    });
    hud.meter('pips');
    hud.setPips(1, 0);
  }

  // Hold-to-bake handler (only active in the bake phase).
  down() {
    if (this.phase !== 'bake') return false;
    this.holding = true;
    this.loop ??= sound.loop('oven');
    return true;
  }

  move() {}

  up() {
    if (!this.holding) return;
    this.holding = false;
    this.loop?.set(0.2);
    if (this.meter.progress >= 0.25) this.finishBake();
  }

  update(dt: number, t: number) {
    const { k, pan, hud } = this.ctx;
    this.doorOpen += (this.doorTarget - this.doorOpen) * (1 - Math.exp(-8 * dt));
    this.door.rotation.x = 1.5 * this.doorOpen;
    this.light.intensity = this.heat * 0.35;
    this.glass.emissive.set(0xff7a20);
    this.glass.emissiveIntensity = this.heat * 0.6;

    switch (this.phase) {
      case 'carry':
        this.carry.update(dt, t);
        break;
      case 'closing': {
        this.animT += dt;
        const e = ease(this.animT / 0.6);
        pan.position.lerpVectors(this.from, this.inside, e);
        pan.position.y += Math.sin(e * Math.PI) * 0.03;
        pan.rotation.set(0, 0, 0);
        if (this.animT > 0.6) { this.doorTarget = 0; }
        if (this.animT > 0.95) {
          sound.play('door', { gain: 0.6 });
          this.phase = 'bake';
          k.pointer.handlers.splice(k.pointer.handlers.indexOf(this.carry), 1);
          k.pointer.handlers.unshift(this);
          hud.meter('ring');
          hud.setRing(0, this.meter.sweet);
          hud.hint('Hold to bake. Hotter! Watch the top.');
        }
        break;
      }
      case 'bake': {
        this.heat += ((this.holding ? 1 : 0.15) - this.heat) * (1 - Math.exp(-4 * dt));
        if (this.holding) {
          this.meter.advance(dt);
          this.loop?.set(1);
          if (this.meter.inSweet && !this.dingDone) { this.dingDone = true; sound.play('ding', { gain: 0.6 }); }
          if (this.meter.progress >= 1) this.finishBake();
        }
        // The cake puffs up and the top scorches.
        this.fill.scale.y = 0.045 * (1 + this.meter.progress * 0.5);
        this.fill.position.y = 0.006 + this.fill.scale.y / 2;
        this.fillMat.color.copy(topColor(this.meter.progress));
        hud.setRing(this.meter.progress, this.meter.sweet);
        break;
      }
      case 'opening': {
        this.animT += dt;
        this.heat = Math.max(0, this.heat - dt * 2);
        if (this.animT > 0.4) this.doorTarget = 1;
        if (this.animT > 0.9) {
          this.phase = 'out';
          this.animT = 0;
          this.from.copy(pan.position);
        }
        break;
      }
      case 'out': {
        this.animT += dt;
        const e = ease(this.animT / 0.7);
        pan.position.lerpVectors(this.from, this.outPos, e);
        pan.position.y += Math.sin(e * Math.PI) * 0.04;
        if (this.animT > 0.7) { this.doorTarget = 0; }
        if (this.animT > 1.0) { this.phase = 'carry'; this.ctx.done(this.result); }
        break;
      }
    }
  }

  private finishBake() {
    if (this.phase !== 'bake') return;
    this.result = this.meter.result();
    this.holding = false;
    this.loop?.stop();
    this.loop = null;
    sound.play('ding');
    this.phase = 'opening';
    this.animT = 0;
    this.ctx.hud.hint(this.result === 'right' ? 'PERFECT burnt top!!' : this.result === 'under' ? 'A little pale, but lovely.' : 'Extra toasty! Crunchy edges.');
  }

  dispose() {
    const { k } = this.ctx;
    const i = k.pointer.handlers.indexOf(this.carry);
    if (i >= 0) k.pointer.handlers.splice(i, 1);
    const j = k.pointer.handlers.indexOf(this);
    if (j >= 0) k.pointer.handlers.splice(j, 1);
    this.loop?.stop();
    this.light.intensity = 0;
    this.glass.emissiveIntensity = 0;
    this.door.rotation.x = 0;
  }

  targets() {
    const mouth = this.ctx.oven.position.clone().add(new THREE.Vector3(0, 0.1, 0.15));
    return { pan: this.ctx.pan.position.clone(), ovenMouth: mouth, anywhere: this.outPos.clone() };
  }

  progress() { return { progress: this.meter.progress, stage: this.phase }; }

  meterInfo() { return { duration: this.meter.duration, sweet: this.meter.sweet }; }

  debug() { return { holding: this.holding, heat: this.heat, doorOpen: this.doorOpen, panArrived: this.panArrived, carrying: !!this.carry?.held }; }
}

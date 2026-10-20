// Step: pour the batter into the pan. Hold anywhere: the bowl lifts, tips, and the
// batter runs into the pan while you hold.
import * as THREE from 'three';
import { SLOT } from '../kitchen';
import { HoldMeter } from '../gestures';
import { Stream } from '../stream';
import { FLAVOR_TINT } from '../props';
import { sound, type Loop } from '../sound';
import type { PointerHandler } from '../input';
import { ease, type StepContext, type StepRunner } from './step';

const BATTER: Record<string, number> = { classic: 0xfcebc4, blueberry: 0xd9c3e6, lemon: 0xfbf0b0 };

export class PourPanStep implements StepRunner, PointerHandler {
  private readonly meter = new HoldMeter(2.2, [0.55, 0.85]);
  private holding = false;
  private lift = 0;
  private readonly stream: Stream;
  private loop: Loop | null = null;
  private startLevel = 0;
  private finished = false;
  private fill!: THREE.Mesh;
  private fillMat!: THREE.MeshStandardMaterial;
  private rippleT = 0;

  constructor(private readonly ctx: StepContext) {
    this.stream = new Stream(ctx.k.scene, BATTER[ctx.flavor.id] ?? BATTER.classic);
  }

  start() {
    const { k, bowl, pan, hud, station, flavor } = this.ctx;
    pan.position.copy(k.at(SLOT.front, station));
    pan.visible = true;
    this.fill = pan.getObjectByName('fill') as THREE.Mesh;
    this.fillMat = this.fill.material as THREE.MeshStandardMaterial;
    this.fillMat.color.set(BATTER[flavor.id] ?? BATTER.classic);
    this.fill.visible = false;
    this.startLevel = bowl.level;
    bowl.setColor(BATTER[flavor.id] ?? BATTER.classic);
    k.pointer.handlers.unshift(this);
    hud.meter('ring');
    hud.setRing(0, this.meter.sweet);
  }

  down() {
    if (this.finished) return false;
    this.holding = true;
    this.loop ??= sound.loop('pour');
    return true;
  }

  move() {}

  up() {
    this.holding = false;
    this.loop?.set(0);
    if (this.meter.progress >= 0.25) this.finish();
  }

  update(dt: number, t: number) {
    const { bowl, pan, hud } = this.ctx;
    this.lift += ((this.holding ? 1 : 0) - this.lift) * (1 - Math.exp(-7 * dt));
    const e = ease(this.lift);
    // The bowl rises, slides toward the pan and tips forward.
    const up = bowl.home.clone().add(new THREE.Vector3(0, 0.11, 0.02));
    bowl.group.position.lerpVectors(bowl.home, up, e);
    bowl.group.rotation.x = 0.9 * e;
    const pouring = this.holding && this.lift > 0.9 && !this.finished;
    if (pouring) {
      this.meter.advance(dt);
      const lip = bowl.group.localToWorld(new THREE.Vector3(0, bowl.rimY, bowl.rimRadius - 0.01));
      const landing = pan.position.clone().add(new THREE.Vector3(0, 0.01 + this.fillHeight(), 0));
      this.stream.flow = Math.min(1, this.stream.flow + dt * 5);
      this.stream.radius = 0.012;
      this.stream.from.copy(lip);
      this.stream.to.copy(landing);
      this.loop?.set(0.8);
      bowl.setLevel(this.startLevel * (1 - Math.min(1, this.meter.progress * 1.2)));
      if (this.meter.progress >= 1) this.finish();
    } else {
      this.stream.flow = Math.max(0, this.stream.flow - dt * 8);
    }
    this.stream.update(t);
    const h = this.fillHeight();
    this.fill.visible = h > 0.001;
    this.fill.scale.y = Math.max(h, 0.001);
    this.fill.position.y = 0.006 + h / 2;
    hud.setRing(this.meter.progress, this.meter.sweet);
  }

  private fillHeight() { return Math.min(1, this.meter.progress * 1.1) * 0.045; }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.holding = false;
    this.loop?.stop();
    this.loop = null;
    this.ctx.done(this.meter.result());
  }

  dispose() {
    const { k, bowl } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    this.stream.dispose(k.scene);
    this.loop?.stop();
    bowl.group.position.copy(bowl.home);
    bowl.group.rotation.set(0, 0, 0);
    bowl.setLevel(0, true);
  }

  targets() {
    return { anywhere: this.ctx.pan.position.clone(), pan: this.ctx.pan.position.clone() };
  }
}

export { FLAVOR_TINT };

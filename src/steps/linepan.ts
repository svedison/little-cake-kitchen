// Step: line the pan. Drag the parchment sheet onto the pan; it crumples in.
import * as THREE from 'three';
import { SLOT } from '../kitchen';
import { Carry } from '../gestures';
import { makeParchment } from '../props';
import { sound } from '../sound';
import type { StepContext, StepRunner } from './step';

export class LinePanStep implements StepRunner {
  private readonly sheet = makeParchment();
  private carry!: Carry;
  private placedT = -1;
  private wiggle = 0;

  constructor(private readonly ctx: StepContext) {}

  start() {
    const { k, pan, station, hud } = this.ctx;
    pan.position.copy(k.at(SLOT.front, station)).add(new THREE.Vector3(0.08, 0, 0));
    pan.rotation.set(0, 0, 0);
    pan.visible = true;
    this.sheet.position.copy(k.at(SLOT.front, station)).add(new THREE.Vector3(-0.085, 0, 0.01));
    this.sheet.scale.setScalar(0.8);
    k.scene.add(this.sheet);

    this.carry = new Carry(k, [{ obj: this.sheet, home: this.sheet.position.clone(), placed: false }], {
      holdY: 0.07,
      grabPx: 80,
      onDrop: (_item, pos) => {
        const d = Math.hypot(pos.x - pan.position.x, pos.z - pan.position.z);
        if (d > 0.08) return false;
        this.sheet.visible = false;
        pan.getObjectByName('lining')!.visible = true;
        sound.play('paper');
        this.placedT = 0;
        this.wiggle = 1;
        hud.setPips(1, 1);
        hud.hint('Perfect, nice and snug.');
        return true;
      },
    });
    k.pointer.handlers.unshift(this.carry);
    hud.meter('pips');
    hud.setPips(1, 0);
  }

  update(dt: number, t: number) {
    this.carry.update(dt, t);
    if (this.carry.held) {
      // The sheet floats flat while carried; a little flutter sells the paper.
      this.sheet.rotation.x = Math.sin(t * 6) * 0.06;
      this.sheet.rotation.z = Math.cos(t * 5) * 0.06;
    }
    if (this.wiggle > 0) {
      this.wiggle = Math.max(0, this.wiggle - dt * 2.5);
      this.ctx.pan.rotation.z = Math.sin(this.wiggle * Math.PI * 3) * 0.08 * this.wiggle;
    }
    if (this.placedT >= 0) {
      this.placedT += dt;
      if (this.placedT > 0.7) { this.placedT = -1; this.ctx.done(); }
    }
  }

  dispose() {
    const { k } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this.carry), 1);
    k.scene.remove(this.sheet);
    this.ctx.pan.rotation.set(0, 0, 0);
  }

  targets() {
    return { sheet: this.sheet.position.clone(), pan: this.ctx.pan.position.clone() };
  }
}

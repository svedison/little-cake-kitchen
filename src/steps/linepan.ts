// Step: line the pan. Drag the parchment sheet onto the pan; it drops the last centimetre
// in, its middle presses down onto the floor and its edges run up the wall in pleats.
import * as THREE from 'three';
import { SLOT } from '../kitchen';
import { Carry } from '../gestures';
import { makeParchment, liningRadius, LINING, LINING_FLOOR_Y } from '../props';
import { motion, easeInOutCubic, linear } from '../motion';
import { sound } from '../sound';
import type { StepContext, StepRunner } from './step';

const SHEET_SCALE = 0.6;   // the sheet on the counter, folded to fit the slot
const ARC_T = 0.18;        // s, the last centimetre into the pan
const FOLD_T = 0.42;       // s, the sheet folds down into the pan and up its wall
const PLEATS = 7;          // the folds the paper bunches into as it climbs the wall
const DONE_AFTER = 0.4;    // s from the pip filling to done()
const BOWL_T = 0.4;        // s the bowl takes to slide aside
/** Off the right edge at every viewport, level with the bowl's slot and clear of the oven (x 0.78 on): where the bowl waits while the pan is lined. */
const BOWL_ASIDE = new THREE.Vector3(0.64, 0, SLOT.bowl.z);

export class LinePanStep implements StepRunner {
  private readonly sheet = makeParchment();
  private carry!: Carry;
  private lining!: THREE.Object3D;
  private lined = false;
  private finished = false;
  private doneT = -1;

  constructor(private readonly ctx: StepContext) {}

  start() {
    const { k, pan, station, hud } = this.ctx;
    this.lining = pan.getObjectByName('lining')!;
    // The bowl is not part of this Step: it slides off to the right (a phone's view is too
    // narrow for bowl, sheet and pan at once), the sheet pops in on its slot behind the pan,
    // and the pan arcs in from the park slot and lands. The bowl comes back in leave().
    const { bowl } = this.ctx;
    const bowlOut = k.glide(bowl.group, k.at(BOWL_ASIDE, station), BOWL_T);
    this.sheet.position.copy(k.at(SLOT.bowl, station)).setY(0);
    this.sheet.scale.setScalar(SHEET_SCALE);
    this.sheet.visible = false;
    k.scene.add(this.sheet);
    const sheetIn = motion.delay(BOWL_T * 0.6).then(() => { this.sheet.visible = true; return motion.popIn(this.sheet, 0.28); });
    pan.position.copy(k.at(SLOT.park, station));
    pan.rotation.set(0, 0, 0);
    pan.visible = true;
    const panIn = motion.arcTo(pan, k.at(SLOT.front, station), 0.5, 0.04).then(() => {
      sound.play('clink', { gain: 0.35, rate: 0.9 });
      return motion.squash(pan, 0.08, 0.22);
    });

    this.carry = new Carry(k, [{ obj: this.sheet, home: this.sheet.position.clone(), placed: false }], {
      holdY: 0.12, // carried well up, so it sways over the pan's ring as it comes
      grabPx: 80,
      flutter: 0.06, // paper sways more than a pan
      receiver: () => pan,
      onGrab: () => sound.play('paper', { gain: 0.35, rate: 1.2 }),
      onDrop: (_item, pos) => {
        // Over the pan as the player sees it: follow the view ray from the carried sheet down
        // to the pan's rim height (the sheet is carried high, so straight down lands short).
        const cam = k.camera.position;
        const s = (pan.position.y + 0.05 - cam.y) / (pos.y - cam.y);
        const d = Math.hypot(cam.x + (pos.x - cam.x) * s - pan.position.x, cam.z + (pos.z - cam.z) * s - pan.position.z);
        if (d > 0.08) return false;
        this.tuckIn();
        return true;
      },
    });
    k.pointer.handlers.unshift(this.carry);
    hud.meter('pips');
    hud.setPips(1, 0);
    return Promise.all([bowlOut, sheetIn, panIn]).then(() => {});
  }

  /** In range: the last centimetre into the pan, then the sheet folds itself in. */
  private tuckIn() {
    const { pan } = this.ctx;
    const sheet = this.sheet;
    const from = sheet.position.clone();
    const rot = sheet.rotation.clone();
    const into = pan.position.clone().setY(pan.position.y + 0.012);
    sound.play('paper');
    motion.tween(ARC_T, easeInOutCubic, (k) => {
      sheet.position.lerpVectors(from, into, k);
      sheet.position.y += 0.01 * 4 * k * (1 - k);
      sheet.rotation.set(rot.x * (1 - k), 0, rot.z * (1 - k)); // flat as it lands
    }).then(() => this.fold());
  }

  /**
   * The sheet folds into the pan: its middle presses down onto the floor first, then the paper
   * further out follows, running up the wall and bunching into pleats as it goes (the edge has
   * more paper than the wall has room for), settling into the lining's own crinkle. Then the
   * lining (the same shape) takes over and the sheet goes.
   */
  private fold() {
    const { pan } = this.ctx;
    const sheet = this.sheet;
    const mesh = sheet.children[0] as THREE.Mesh;
    const geo = mesh.geometry;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    // Into the pan's frame, so it squashes with the pan as the drop lands.
    const flat: THREE.Vector3[] = [];
    const goal: THREE.Vector3[] = [];
    const reach: number[] = [];
    const ang: number[] = [];
    sheet.updateMatrixWorld(true);
    pan.updateMatrixWorld(true);
    const toPan = new THREE.Matrix4().copy(pan.matrixWorld).invert().multiply(mesh.matrixWorld);
    const L = LINING.r0 + LINING.h; // paper from the middle to the top of the collar
    for (let i = 0; i < pos.count; i++) {
      flat.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toPan));
      // square -> disc, so the middle of each side and the corners all reach the collar's top
      const u = pos.getX(i) / 0.1, v = -pos.getY(i) / 0.1;
      const dx = u * Math.sqrt(1 - (v * v) / 2), dz = v * Math.sqrt(1 - (u * u) / 2);
      const r = Math.min(1, Math.hypot(dx, dz)), a = Math.atan2(dz, dx);
      const s = r * L;
      if (s <= LINING.r0) goal.push(new THREE.Vector3(Math.cos(a) * s, LINING_FLOOR_Y, Math.sin(a) * s));
      else {
        const y = LINING.y0 + LINING.h * Math.min(1, (s - LINING.r0) / LINING.h);
        const rr = liningRadius(y, a);
        goal.push(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr));
      }
      reach.push(r);
      ang.push(a);
    }
    sheet.getObjectByName('edge')!.visible = false;
    pan.add(sheet);
    sheet.position.set(0, 0, 0);
    sheet.rotation.set(0, 0, 0);
    sheet.scale.setScalar(1);
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const c0 = mat.color.clone();
    const c1 = (this.lining as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const p = new THREE.Vector3();
    let crinkled = false;
    sound.play('paper', { gain: 0.5, rate: 0.8 });
    return motion.tween(FOLD_T, linear, (k) => {
      for (let i = 0; i < pos.count; i++) {
        // the middle goes first, the edges follow 0.55 of the way behind
        const e = easeInOutCubic((k - 0.55 * reach[i]) / 0.45);
        p.lerpVectors(flat[i], goal[i], e);
        // the pleats bunch up as the paper climbs the wall, then ease into the lining's crinkle
        const bunch = Math.sin(Math.PI * e) * THREE.MathUtils.smoothstep(reach[i], 0.45, 1);
        const pr = 1 + 0.06 * bunch * Math.sin(ang[i] * PLEATS);
        p.x *= pr; p.z *= pr;
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      mat.color.copy(c0).lerp(c1.color, k);
      if (!crinkled && k > 0.55) { crinkled = true; sound.play('paper', { gain: 0.4, rate: 1.05 }); }
    }).then(() => {
      this.lining.visible = true;
      sheet.visible = false;
    });
  }

  update(dt: number, t: number) {
    this.carry.update(dt, t);
    const { hud } = this.ctx;
    if (!this.lined && this.lining.visible && this.lining.scale.x >= 0.99) {
      this.lined = true;
      hud.setPips(1, 1);
      hud.hint('Perfect, nice and snug.');
      this.doneT = 0;
    }
    if (this.doneT >= 0 && !this.finished) {
      this.doneT += dt;
      if (this.doneT >= DONE_AFTER) { this.finished = true; this.ctx.done(); }
    }
  }

  /** The lined pan slides off to the park slot (it comes back when the batter is ready) as the bowl slides home. */
  async leave() {
    const { k, pan, station, bowl } = this.ctx;
    await Promise.all([k.glide(pan, k.at(SLOT.park, station), 0.5), k.glide(bowl.group, bowl.home, 0.5)]);
    pan.visible = false;
  }

  dispose() {
    const { k, bowl } = this.ctx;
    bowl.group.position.copy(bowl.home); // already there unless the Step was cut short
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this.carry), 1);
    this.sheet.removeFromParent();
  }

  targets() {
    return { sheet: this.sheet.position.clone(), pan: this.ctx.pan.position.clone() };
  }

  focus() { return this.sheet.visible ? this.sheet : null; }

  boxes(): Record<string, THREE.Object3D> {
    const { pan } = this.ctx;
    return { sheet: this.sheet, ring: pan.getObjectByName('ring')!, lining: this.lining };
  }

  debug() {
    return { carry: this.carry.info(), carryRotMax: this.carry.maxRotDelta, liningScale: this.lining.visible ? this.lining.scale.x : 0, sheetVisible: this.sheet.visible };
  }
}

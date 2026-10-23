// Step: mix cream cheese and sugar. Circle a finger in the bowl; the whisk follows a touch
// behind on a spring, leans into its travel with its handle tipped out from the middle,
// dips into the batter while it is going and lifts as it slows. The lumps pop one by one,
// the surface swirls the way you stir. Stop in the sweet zone for "smooth".
import * as THREE from 'three';
import { HoldMeter, StirTracker, pauseEnds } from '../gestures';
import { makeWhisk } from '../props';
import { motion, Spring3, easeInBack, easeOutCubic, linear } from '../motion';
import { sound, type Loop } from '../sound';
import type { PointerHandler } from '../input';
import type { StepContext, StepRunner } from './step';

const TURNS_NEEDED = 7;
const LUMPS = 7;
const REACH = 0.085;       // m from the bowl's axis the whisk may go
const DIP = 0.006;         // m the wires sit under the surface while stirring...
const RAISE = 0.01;        // ...and over it as the stir dies down
const UP_LIFT = 0.02;      // m it comes up when the finger lifts, dripping
const TILT_MAX = 0.35;     // rad it leans into its travel
const TILT_GAIN = 0.6;     // rad per m/s
const RADIAL = 0.25;       // rad the handle tips away from the middle
const DROP_IN = 0.08;      // m above its rest it drops in from
const ARRIVE_AFTER = 0.3;  // s after the Step starts
const CAT_PX = 45;         // px round the cat's face that never start a stir
const WIRE_R = 0.08;       // m from the axis past which the wires scrape the bowl's wall...
const WIRE_EVERY = 0.18;   // ...ticking on it this often (s, by ear)

interface Lump { mesh: THREE.Mesh; at: number; popped: boolean }

export class StirStep implements StepRunner, PointerHandler {
  private readonly whisk = makeWhisk();
  private readonly lumps: Lump[] = [];
  private readonly meter = new HoldMeter(1, [0.55, 0.85]);
  private readonly stir = new StirTracker();
  // Tuned by eye: a whisk in thick batter trails the finger a little.
  private readonly follow = new Spring3(undefined, 140, 0.85);
  private readonly vel = new THREE.Vector3(); // smoothed, m/s
  private readonly tilt = new THREE.Vector2();
  private arrived = false;
  private holding = false;
  private pointer = { x: 0, y: 0 };
  private rippleT = 0;
  private liftT = Infinity; // s since the finger lifted
  private pausedFor = Infinity; // s the finger has been up mid-stir (a lift is a pause, see pauseEnds)
  private dripped = true;
  private extraLift = 0;
  private loop: Loop | null = null;
  private finished = false;
  private dingDone = false;
  private wireT = 0;
  private readonly v = new THREE.Vector3();

  constructor(private readonly ctx: StepContext) {}

  start() {
    const { k, bowl, hud } = this.ctx;
    bowl.setLevel(0.02, true);
    bowl.setColor(0xfff3d6, true);
    const lumpMat = new THREE.MeshStandardMaterial({ color: 0xfff8e6, roughness: 0.9 });
    for (let i = 0; i < LUMPS; i++) {
      const lump = new THREE.Mesh(new THREE.SphereGeometry(0.009 + Math.random() * 0.006, 12, 10), lumpMat);
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.05;
      lump.position.set(Math.cos(a) * r, bowl.floorY + 0.02, Math.sin(a) * r);
      lump.castShadow = true;
      bowl.group.add(lump);
      // Each lump gives way at its own point of the stir, spread evenly over 0.15-0.85 with a
      // little jitter, so they go one at a time.
      const at = 0.15 + ((i + 0.2 + Math.random() * 0.6) / LUMPS) * 0.7;
      this.lumps.push({ mesh: lump, at, popped: false });
      motion.delay(i * 0.04).then(() => motion.popIn(lump, 0.22));
      lump.visible = false;
    }
    k.scene.add(this.whisk);
    // The whisk drops in from above and lands with a little squash.
    const rest = this.restPoint(new THREE.Vector3());
    this.whisk.position.copy(rest).setY(rest.y + DROP_IN);
    this.whisk.visible = false;
    this.tilt.set(rest.x - bowl.home.x, rest.z - bowl.home.z).setLength(RADIAL); // handle tipped out from the middle
    this.applyTilt();
    const arrive = motion.delay(ARRIVE_AFTER).then(() => {
      this.whisk.visible = true;
      return motion.arcTo(this.whisk, rest, 0.22, 0.01);
    }).then(() => {
      sound.play('clink', { gain: 0.3, rate: 1.4 });
      bowl.ripple(this.whisk.position, 0.4);
      this.follow.jump(this.whisk.position);
      this.arrived = true;
      return motion.squash(this.whisk, 0.12, 0.2);
    });
    k.pointer.handlers.unshift(this);
    hud.meter('ring');
    hud.setRing(0, this.meter.sweet);
    return arrive;
  }

  /** Where the whisk stands when nobody is stirring: a little right of the middle, wires just over the batter. */
  private restPoint(out: THREE.Vector3) {
    const { bowl } = this.ctx;
    return out.set(bowl.home.x + 0.03, bowl.surfaceY() + RAISE, bowl.home.z + 0.02);
  }

  down(x: number, y: number) {
    if (this.finished) return false;
    const { k, bowl, cat } = this.ctx;
    if (k.screenDist(x, y, bowl.home.clone().setY(bowl.surfaceY())) > 170) return false;
    // a finger on the cat's face is a pat for the cat (a Nudge), not a stir
    if (k.screenDist(x, y, cat.mouth()) < CAT_PX) return false;
    this.holding = true;
    this.liftT = Infinity;
    this.pausedFor = Infinity;
    this.pointer = { x, y };
    this.loop ??= sound.loop('whisk');
    return true;
  }

  move(x: number, y: number) { this.pointer = { x, y }; }

  up() {
    this.holding = false;
    this.stir.lift();
    this.loop?.set(0);
    this.liftT = 0;
    this.dripped = false;
    this.pausedFor = 0;
    if (this.meter.progress < this.meter.sweet[0]) this.ctx.hud.hint('Keep going, round and round!');
  }

  update(dt: number, t: number) {
    const { k, bowl, hud } = this.ctx;
    const centre = k.toScreen(bowl.home.clone().setY(bowl.surfaceY()));
    if (this.holding && !this.finished) {
      this.stir.update(this.pointer.x, this.pointer.y, centre.x, centre.y, dt);
      this.meter.progress = Math.min(1, this.stir.turns / TURNS_NEEDED);
      this.rippleT += dt;
      if (this.rippleT > 0.09 && this.stir.speed > 1 && this.arrived) {
        this.rippleT = 0;
        bowl.ripple(this.whisk.position, Math.min(1, this.stir.speed / 10));
      }
      // Clockwise on screen is clockwise seen from above: negative about +y.
      bowl.spin = -this.stir.dir * Math.min(3, this.stir.speed * 0.25);
      // the whisk's swish follows the speed, pulsing with each stroke (twice a turn)
      this.loop?.set(Math.min(1, this.stir.speed / 9), { phase: this.stir.phase });
      // out by the wall the wires tick on the ceramic
      this.wireT -= dt;
      const r = Math.hypot(this.whisk.position.x - bowl.home.x, this.whisk.position.z - bowl.home.z);
      if (r > WIRE_R && this.stir.speed > 1 && this.wireT <= 0) {
        this.wireT = WIRE_EVERY;
        sound.play('tink', { gain: 0.1 + 0.1 * Math.min(1, this.stir.speed / 10), rate: 0.9 + Math.random() * 0.2 });
      }
      if (this.meter.inSweet && !this.dingDone) { this.dingDone = true; sound.play('chime', { gain: 0.6, rate: 1.12 }); }
      if (this.meter.progress >= 1) this.finish();
    } else {
      this.stir.decay(dt);
      if (!this.finished && this.pausedFor !== Infinity) {
        this.pausedFor += dt;
        if (this.pausedFor >= pauseEnds(this.meter.progress, this.meter.sweet, 0.2)) this.finish();
      }
    }
    hud.setRing(this.meter.progress, this.meter.sweet);
    if (this.arrived) this.moveWhisk(dt, t);
    // the cat leans in to watch the whisk go round, the faster the closer
    if (this.holding && !this.finished) this.ctx.cat.leanTo(this.whisk.position, 0.4 + Math.min(0.6, this.stir.speed / 8));
    this.popLumps();
    bowl.setColor(this.meter.progress > 0.5 ? 0xfff0c8 : 0xfff3d6);
  }

  /** The whisk chases the finger on its spring, dips while going, lifts as it slows. */
  private moveWhisk(dt: number, t: number) {
    const { k, bowl } = this.ctx;
    const target = this.v;
    const f = this.holding && !this.finished ? k.fingerAt(this.pointer.x, this.pointer.y, bowl.surfaceY()) : null;
    if (f) {
      target.copy(f).sub(bowl.home);
      const r = Math.hypot(target.x, target.z);
      if (r > REACH) { target.x *= REACH / r; target.z *= REACH / r; }
      target.add(bowl.home);
    } else {
      target.copy(this.follow.target);
    }
    // in the batter while it is going, over it as it slows; up and dripping once let go
    const going = Math.min(1, this.stir.speed);
    this.liftT += dt;
    const lifted = this.liftT < Infinity ? easeOutCubic(this.liftT / 0.25) * UP_LIFT : 0;
    target.y = bowl.surfaceY() + RAISE - (RAISE + DIP) * going + lifted + this.extraLift;
    this.follow.set(target).step(dt);
    this.whisk.position.copy(this.follow.value);
    if (!this.dripped && this.liftT > 0.3) {
      this.dripped = true;
      bowl.ripple(this.v.copy(this.whisk.position).setY(bowl.surfaceY()), 0.35, 0.8);
      sound.play('drip', { gain: 0.25, rate: 0.8 }); // a drop off the lifted wires
    }
    // The lean: into its travel (from the smoothed velocity), plus the handle tipped out from the middle.
    this.vel.lerp(this.follow.velocity, 1 - Math.exp(-12 * dt));
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const lean = Math.min(TILT_MAX, sp * TILT_GAIN);
    const rx = this.whisk.position.x - bowl.home.x, rz = this.whisk.position.z - bowl.home.z;
    const r = Math.hypot(rx, rz);
    const out = RADIAL * Math.min(1, r / 0.03) / Math.max(r, 1e-6);
    this.tilt.set(rx * out, rz * out);
    if (sp > 1e-4) this.tilt.add({ x: (this.vel.x / sp) * lean, y: (this.vel.z / sp) * lean });
    // the wires chatter a little against the bowl when it is going fast
    const shake = Math.sin(t * 20) * 0.04 * Math.min(1, this.stir.speed / 5);
    this.applyTilt(shake);
  }

  /** Tip the top toward tilt (x, z), as small angles about x and z. */
  private applyTilt(shake = 0) {
    this.whisk.rotation.set(this.tilt.y, 0, -this.tilt.x + shake);
  }

  /** Each lump gives way when the stir passes its point: a swell, then gone. */
  private popLumps() {
    for (const l of this.lumps) {
      if (l.popped || this.meter.progress < l.at) continue;
      l.popped = true;
      const m = l.mesh;
      motion.release(m);
      sound.play('squelch', { gain: 0.18, rate: 1.3 + Math.random() * 0.3 }); // a lump giving way: soft, wet
      motion.tween(0.25, linear, (k) => {
        const s = k < 0.35 ? 1 + 0.3 * easeOutCubic(k / 0.35) : 1.3 * (1 - easeInBack((k - 0.35) / 0.65));
        m.scale.setScalar(Math.max(0.001, s));
      }).then(() => { m.visible = false; });
    }
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.loop?.stop();
    this.loop = null;
    this.ctx.done(this.meter.result());
  }

  /** The whisk comes up out of the bowl and pops away; any lumps left go with it. */
  async leave() {
    this.extraLift = UP_LIFT;
    await motion.delay(0.2);
    const outs: Promise<void>[] = [motion.popOut(this.whisk, 0.2)];
    for (const l of this.lumps) if (!l.popped) { l.popped = true; outs.push(motion.popOut(l.mesh, 0.2)); }
    await Promise.all(outs);
    this.whisk.visible = false;
  }

  dispose() {
    const { k, bowl } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    k.scene.remove(this.whisk);
    for (const l of this.lumps) bowl.group.remove(l.mesh);
    this.loop?.stop();
    bowl.spin = 0;
  }

  targets() {
    const { bowl } = this.ctx;
    return { bowl: bowl.home.clone().setY(bowl.surfaceY()) };
  }

  /** The finger cue circles the middle of the bowl, the way a stir goes. */
  cue() {
    const { bowl } = this.ctx;
    return { name: 'bowl', at: bowl.home.clone().setY(bowl.surfaceY()), circle: true };
  }

  progress() { return { progress: this.meter.progress, stage: this.finished ? 'done' : this.holding ? 'stirring' : 'idle' }; }

  meterInfo() { return { duration: this.meter.duration, sweet: this.meter.sweet }; }

  debug() {
    const { bowl } = this.ctx;
    return {
      turns: this.stir.turns, stirSpeed: this.stir.speed, holding: this.holding,
      whiskTilt: this.whisk.rotation.z,
      lumps: this.lumps.filter((l) => !l.popped).length,
      lift: this.whisk.position.y - bowl.surfaceY(),
      whiskArrived: this.arrived,
    };
  }

  focus() { return this.whisk; }

  boxes(): Record<string, THREE.Object3D> { return { whisk: this.whisk }; }
}

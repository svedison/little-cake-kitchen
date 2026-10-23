// Step: pour the batter into the pan. Press and hold the bowl (slide the finger down to tip it
// further and pour harder, up to tip it back and slow it): it dips, lifts over the pan and
// tips forward about its lip; the batter inside stays level with the world and slides to
// the lip, runs off it as a ribbon that arcs into the pan, and the pan fills from a mound
// where it lands, spreading out to the paper and rising toward the pink seam on the collar
// (the "just right" line). Berries in the batter roll out over the lip as the bowl empties
// and plop into the pan. Let go and the bowl tips back and is set down with a little squash.
// Nothing is a fluid (ADR-0002) and nothing ever overflows: past the seam the batter only
// thickens into a darker lip round the collar.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SLOT } from '../kitchen';
import { HoldMeter, pauseEnds } from '../gestures';
import { Stream } from '../stream';
import { SoftSurface } from '../surface';
import { FLAVOR_TINT, PAN, BERRY_R, seamPoint } from '../props';
import { motion, easeOutBack, easeInOutCubic, easeOutCubic } from '../motion';
import { sound, type Loop } from '../sound';
import type { PointerHandler } from '../input';
import type { StepContext, StepRunner } from './step';

const BATTER: Record<string, number> = { classic: 0xfcebc4, blueberry: 0xd9c3e6, lemon: 0xfbf0b0 };

// The bowl's moves. It lifts up and toward the pan, high enough to clear the collar, then
// comes down a little as it tips so its lip ends up ~11 cm over the pan's floor, above the
// pan's centre-back. Tuned by eye on a 390 px phone: centred over the pan (further right
// the tipped bowl leaves the screen) and no higher (higher, it reaches the header).
const RAISE = new THREE.Vector3(-0.006, 0.07, 0.055);
const LIP_ABOVE_PAN = 0.11;      // m, the lip over the pan's floor while it pours...
// ...and how much lower and further over the pan it comes as it tips further, the way a hand
// follows a pour through: the wall under the lip swings up out of the collar's way, and a
// lower bowl's far rim stays clear of the header (tuned by eye on a 390 px phone)
const LIP_SINK = 0.03, LIP_FORWARD = 0.02, LIP_SINK_AT = 1.05;
const DIP = 0.005, DIP_T = 0.1;  // m, s: the little crouch before the lift (anticipation)
const RISE_T = 0.45;             // s
const TILT_T = 0.35;             // s from upright to pouring
const TILT_FULL = 0.45;          // rad: a full bowl pours at a shallow tip...
const TILT_EMPTY = 1.5;          // ...an empty one is nearly on its side (both what a still finger holds)
// The finger tips it: sliding down from where it pressed tips further and pours harder,
// sliding up tips it back until the batter stops at the lip.
const SPAN = 0.25;               // rad from the first trickle over the lip to a full pour
const REST_FLOW = 0.75;          // the flow a still finger pours at
const TIP_PX = 110;              // px of finger travel down for a trickle -> a full pour
const MAX_TIP = 1.15, MIN_TIP = -0.5; // how far past full and back past the trickle the finger can take it
const DRAIN_AT = 1;              // poured fraction at which the bowl is empty (the end of an "over" pour)
const TIP_BACK_T = 0.2;          // s
const TIP_BACK_TO = 0.3;         // rad: shallow enough that nothing more runs over the lip
const BERRY_TILT = 0.75;         // rad the bowl eases back to while the last berries roll out
const SET_DOWN_T = 0.4;          // s
const RETURN_T = 0.45;           // s, an early let-go: back down to the counter

// The pan filling: a mound first, which spreads out to the paper over the first quarter.
const SPREAD_AT = 0.25;
const MOUND_R0 = 0.03;
const LIP_FROM = 0.85;           // poured fraction past which the collar lip builds ("over")
const LIP_H = 0.006;             // m, the lip's height at a full pour
const BERRY_SINK = 0.003;        // m a berry in the pan sits below the surface
const TRAVEL_T = 0.32;           // s a berry takes to roll from where it was to the lip
const GRAB_PX = 120;             // px: a finger this near the bowl (or on the pan) takes the hold
const PLIP_GAP = 0.03;           // s: berries landing in the same instant are heard as one plip
const SIDE = 0.022;              // m the finger can steer the pouring bowl sideways over the pan (the ribbon stays on the paper)

const HOVER_BACK = 0.12; // rad under its pour point the bowl waits at while the finger is up
type Phase = 'rest' | 'lift' | 'pour' | 'return' | 'leave' | 'done';

/** A berry leaving the bowl: rolls to the lip, flies (a Rapier ball), lands, settles in the pan. */
interface PanBerry {
  mesh: THREE.Mesh;
  state: 'travel' | 'fly' | 'landed' | 'in';
  t: number;
  from: THREE.Vector3; // where it rolled from, in the bowl's frame
  body: RAPIER.RigidBody | null;
  y: number;           // its height in the pan once in (pan frame), below the surface
}

export class PourPanStep implements StepRunner, PointerHandler {
  // a full pour fills it in 1.6 s, a still finger in about 2.1 s (it fills with what lands)
  private readonly meter = new HoldMeter(1.6, [0.55, 0.85]);
  private holding = false;
  private pausedFor = Infinity; // s the finger has been up mid-pour (a lift is a pause, see pauseEnds)
  private downY = 0;   // screen y where the finger pressed
  private fingerY = 0; // and where it is now
  private downX = 0;   // screen x where the finger pressed
  private fingerX = 0; // and where it is now
  private side = 0;    // m the finger has steered the bowl sideways (eased)
  private readonly stream: Stream;
  private loop: Loop | null = null;
  private startLevel = 0;
  private finished = false;
  private fill!: THREE.Mesh;
  private fillMat!: THREE.MeshStandardMaterial;
  private lip!: THREE.Mesh;
  private panArrived = false;
  private readonly batter: number;
  /** The pan's batter top while it pours. */
  private readonly soft: SoftSurface;
  private poured = 0;   // 0..1 of the bowl that has landed in the pan
  private panLevel = 0;
  private spread = 0;
  private readonly centre = new THREE.Vector2(); // the pan surface's centre, pan frame (x, z)
  // the bowl's pose: where its base would be upright, and how far it is tipped about the lip
  private phase: Phase = 'rest';
  private clock = 0;
  private readonly base = new THREE.Vector3();
  private tilt = 0;
  private readonly fromBase = new THREE.Vector3();
  private fromTilt = 0;
  private dipped = false;
  private waitT = 0;
  private readonly raised = new THREE.Vector3();
  private drop = 0; // m the bowl comes down as it tips, so the lip pours from LIP_ABOVE_PAN
  private leaveDone: (() => void) | null = null;
  private readonly left: Promise<void>;
  // berries
  private readonly berries: PanBerry[] = [];
  private floorBody: RAPIER.RigidBody | null = null;
  private launchT = 0;
  private plipT = 0;
  private dbg: Record<string, unknown> = {};
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly lipW = new THREE.Vector3();
  private readonly X = new THREE.Vector3(1, 0, 0);

  constructor(private readonly ctx: StepContext) {
    this.batter = BATTER[ctx.flavor.id] ?? BATTER.classic;
    this.stream = new Stream(ctx.k.scene, this.batter);
    this.soft = new SoftSurface({ color: this.batter, roughness: 0.3, moundSigma: 0.02, edgePin: 3, rings: 14 });
    this.soft.mesh.name = 'fillTop';
    this.soft.mesh.rotation.x = -Math.PI / 2;
    this.soft.mesh.visible = false;
    this.left = new Promise((resolve) => { this.leaveDone = resolve; });
    // the first of the batter meeting the pan's paper: a soft wet slap
    this.stream.onLand = (end) => { if (end === 'head') sound.play('slop', { gain: 0.35, rate: 0.8 }); };
  }

  start() {
    const { k, bowl, pan, hud, station } = this.ctx;
    // The lined pan comes back from the park slot; nothing pours until it is in place.
    pan.position.copy(k.at(SLOT.park, station));
    pan.rotation.set(0, 0, 0);
    pan.visible = true;
    // It arcs over from the park slot and lands with a little squash and a clink.
    const arrive = motion.arcTo(pan, k.at(SLOT.front, station), 0.5, 0.04).then(() => {
      this.panArrived = true;
      sound.play('clink', { gain: 0.35, rate: 0.9 });
      return motion.squash(pan, 0.08, 0.22);
    });
    this.fill = pan.getObjectByName('fill') as THREE.Mesh;
    this.fillMat = this.fill.material as THREE.MeshStandardMaterial;
    this.fillMat.color.set(this.batter);
    this.fill.visible = false;
    this.fill.scale.set(1, 0.001, 1);
    // what an earlier cake left in the fill goes
    for (const c of this.fill.children.filter((c) => c.name === 'berry')) this.fill.remove(c);
    this.lip = this.fill.getObjectByName('fillLip') as THREE.Mesh;
    this.lip.visible = false;
    (this.lip.material as THREE.MeshStandardMaterial).color.set(this.batter).multiplyScalar(0.86); // a touch darker, like a crust forming
    pan.add(this.soft.mesh);
    this.soft.setColor(this.batter, true);
    this.startLevel = bowl.level;
    bowl.setColor(this.batter);
    this.base.copy(bowl.home);
    this.raised.copy(bowl.home).add(RAISE);
    this.drop = Math.max(0, this.raised.y + bowl.lip.y - (k.at(SLOT.front, station).y + PAN.floorY + LIP_ABOVE_PAN));
    this.stream.mode = 'surface';
    this.stream.ellipse = 2.2; // batter runs off a lip as a flat ribbon
    k.pointer.handlers.unshift(this);
    hud.meter('ring');
    hud.setRing(0, this.meter.sweet);
    return arrive;
  }

  /** Is a finger at (x, y) on the bowl or the pan it pours into. */
  private onBowl(x: number, y: number) {
    const { k, bowl, pan } = this.ctx;
    const mid = bowl.group.position.clone().setY(bowl.group.position.y + 0.05);
    return k.screenDist(x, y, mid) < GRAB_PX || k.screenDist(x, y, pan.position) < GRAB_PX * 0.75;
  }

  down(x: number, y: number) {
    if (this.finished) return false;
    // Only a finger on the bowl (or the pan) pours; anywhere else is a Nudge.
    if (!this.onBowl(x, y)) return false;
    this.holding = true;
    this.pausedFor = Infinity;
    this.downY = this.fingerY = y;
    this.downX = this.fingerX = x;
    this.loop ??= sound.loop('glug');
    if (this.panArrived) this.lift();
    return true;
  }

  move(x: number, y: number) { this.fingerX = x; this.fingerY = y; }

  /** m sideways the finger asks for: the bowl follows it over the pan, as far as the paper allows. */
  private sideTarget() {
    const { k, bowl } = this.ctx;
    const planeY = bowl.lipWorld(this.w).y;
    const a = k.fingerAt(this.downX, this.downY, planeY), b = k.fingerAt(this.fingerX, this.downY, planeY);
    return a && b ? THREE.MathUtils.clamp(b.x - a.x, -SIDE, SIDE) : 0;
  }

  /** The tilt a still finger holds it at: shallow while full, steeper as it drains. */
  private restTilt() {
    const drain = Math.min(1, this.poured / DRAIN_AT);
    return TILT_FULL + (TILT_EMPTY - TILT_FULL) * drain * drain * drain;
  }

  /** The tilt of the first trickle over the lip. */
  private pourPoint() { return this.restTilt() - REST_FLOW * SPAN; }

  /** How hard it pours at the tilt it is at: 0 under the pour point, 1 a full pour. */
  private flowAt() { return THREE.MathUtils.clamp((this.tilt - this.pourPoint()) / SPAN, 0, 1); }

  up() {
    if (!this.holding) return;
    this.holding = false;
    this.pausedFor = 0;
    if (this.meter.progress < this.meter.sweet[0]) this.ctx.hud.hint('Press and hold the bowl again, a little more!');
    // Let go: the bowl tips back just short of pouring and waits over the pan for the finger
    // (or the end of the pause). Let go very early and it comes back down; the pan keeps what it has.
    if (this.meter.progress < 0.25 && (this.phase === 'lift' || this.phase === 'pour')) this.go('return');
  }

  private lift() {
    if (this.phase === 'lift' || this.phase === 'pour') return;
    this.dipped = this.phase === 'rest' && this.tilt === 0;
    // the bowl's foot scrapes the counter as it is taken up (only from a standstill)
    if (this.dipped) sound.play('slide', { gain: 0.35, rate: 0.9 });
    this.go('lift');
  }

  private go(phase: Phase) {
    this.phase = phase;
    this.clock = 0;
    this.fromBase.copy(this.base);
    this.fromTilt = this.tilt;
    this.waitT = 0;
    if (phase === 'lift') this.side = 0;
  }

  update(dt: number, t: number) {
    const { bowl, pan, hud } = this.ctx;
    if (!this.holding && !this.finished && this.pausedFor !== Infinity) {
      this.pausedFor += dt;
      if (this.pausedFor >= pauseEnds(this.meter.progress, this.meter.sweet, 0.25)) this.finish();
    }
    if (this.holding && this.panArrived && this.phase !== 'lift' && this.phase !== 'pour' && !this.finished) this.lift();
    this.moveBowl(dt);

    // The stream: off the lip along the rim's downhill tangent, falling onto the pan's batter.
    // It pours as hard as the finger has tipped it past its pour point.
    const flow = this.holding && !this.finished && (this.phase === 'pour' || this.phase === 'lift') ? this.flowAt() : 0;
    if (this.holding && !this.finished) this.ctx.cat.leanTo(pan.position, 0.8); // the cat watches the pan fill
    this.stream.flow = flow > this.stream.flow ? Math.min(flow, this.stream.flow + dt * 5) : Math.max(flow, this.stream.flow - dt * 8);
    if (this.stream.flow < 0.02 && flow === 0) this.stream.flow = 0;
    bowl.lipWorld(this.lipW);
    this.stream.from.copy(this.lipW);
    this.q.setFromAxisAngle(this.X, this.tilt);
    this.stream.dir.set(0, 0, 1).applyQuaternion(this.q);
    // a ribbon 9-11 mm wide in radius terms, fuller the harder it pours
    this.stream.radius = 0.009 + 0.002 * this.stream.flow;
    this.stream.surfaceY = pan.position.y + PAN.floorY + this.panLevel;
    this.stream.update(t, dt);

    // What lands fills the pan; the Result only counts how long it poured.
    const landing = this.stream.landingFlow;
    if (!this.finished) this.meter.advance(dt, landing);
    this.poured = Math.min(1, this.poured + (landing * dt) / this.meter.duration);
    if (!this.finished && this.meter.progress >= 1) this.finish();
    this.fillPan(dt, landing);
    if (this.phase === 'pour' || this.phase === 'lift') bowl.setLevel(Math.max(0.003, this.startLevel * (1 - Math.min(1, this.poured / DRAIN_AT))));
    // The glug runs while the pour is landing and the ring fills (never after a let-go or the
    // end), and the pan's note rises as it fills.
    this.loop?.set(this.holding && !this.finished && landing > 0 ? this.stream.flow : 0, { fill: this.poured });
    this.updateBerries(dt);
    this.soft.update(dt, t);
    hud.setRing(this.meter.progress, this.meter.sweet);
  }

  /** The bowl's pose for this frame, then pivot it about its lip. */
  private moveBowl(dt: number) {
    const { bowl } = this.ctx;
    this.clock += dt;
    const c = this.clock;
    switch (this.phase) {
      case 'lift': {
        // crouch 5 mm, then rise past the spot a touch and settle (easeOutBack), then tip
        const dip = this.dipped ? DIP * easeOutCubic(c / DIP_T) : 0;
        const t0 = this.dipped ? DIP_T : 0;
        const u = (c - t0) / RISE_T;
        if (u <= 0) this.base.copy(this.fromBase).setY(this.fromBase.y - dip);
        else this.base.lerpVectors(this.v.copy(this.fromBase).setY(this.fromBase.y - dip), this.raised, easeOutBack(u));
        const t1 = t0 + RISE_T * 0.6; // the tip starts as the rise settles, so it reads as one move
        const w = easeInOutCubic((c - t1) / TILT_T);
        this.tilt = this.fromTilt + (TILT_FULL - this.fromTilt) * w;
        this.base.y -= this.drop * w;
        if (u >= 1 && c >= t1 + TILT_T) this.phase = 'pour';
        break;
      }
      case 'pour': {
        // tip further as it drains, so the last of it still runs over the lip: slowly while it
        // is full, steeper as it empties (the batter left sits lower and lower in the bowl)
        // (the finger adds to or takes from that: down tips further, up tips back)
        const u = THREE.MathUtils.clamp(REST_FLOW + (this.fingerY - this.downY) / TIP_PX, MIN_TIP, MAX_TIP);
        // no finger: tipped back just under its pour point, so it stops running and waits
        const target = this.holding ? this.pourPoint() + u * SPAN : this.pourPoint() - HOVER_BACK;
        this.tilt += (target - this.tilt) * (1 - Math.exp(-4 * dt)); // a full bowl is heavy: it answers the finger, unhurried
        const k = this.follow();
        // the finger carries it sideways too; a heavy bowl follows a beat behind
        this.side += (this.sideTarget() - this.side) * (1 - Math.exp(-6 * dt));
        this.base.copy(this.raised).add(this.v.set(this.side, -this.drop - LIP_SINK * k, LIP_FORWARD * k));
        break;
      }
      case 'return': {
        this.tilt = this.fromTilt * (1 - easeInOutCubic(c / 0.3));
        // back first, down late, so it clears the collar
        const kb = easeOutCubic(c / RETURN_T), ky = easeInOutCubic((c - 0.08) / (RETURN_T - 0.08));
        const f = this.fromBase, h = bowl.home;
        this.base.set(f.x + (h.x - f.x) * kb, f.y + (h.y - f.y) * ky, f.z + (h.z - f.z) * kb);
        if (c >= RETURN_T) { this.land(0.06); this.phase = 'rest'; }
        break;
      }
      case 'leave': {
        // the berries still in it roll out first (a second at most), then it tips back and is set down
        // (eased back to ~1 rad while they do, which still rolls them over the lip)
        if (this.waitT < 1.2 && this.berriesLeft()) {
          this.waitT += dt;
          this.clock = 0;
          this.tilt += (Math.min(this.tilt, BERRY_TILT) - this.tilt) * (1 - Math.exp(-4 * dt));
          this.fromTilt = this.tilt;
          this.fromBase.copy(this.base);
          break;
        }
        // Tip back to a shallow angle, so the pour stops, and come up a centimetre...
        const k0 = easeOutCubic(c / TIP_BACK_T);
        this.tilt = this.fromTilt + (TIP_BACK_TO - this.fromTilt) * k0;
        this.base.copy(this.fromBase).setY(this.fromBase.y + 0.01 * k0);
        // ...then back and down to the counter, uprighting on the way: it moves back first
        // and drops late, so it clears the collar.
        const k = (c - TIP_BACK_T) / SET_DOWN_T;
        if (k > 0) {
          this.tilt = TIP_BACK_TO * (1 - easeOutCubic(k));
          const kb = easeOutCubic(k), ky = easeInOutCubic(k);
          const y0 = this.fromBase.y + 0.01;
          this.base.set(this.fromBase.x + (bowl.home.x - this.fromBase.x) * kb, y0 + (bowl.home.y - y0) * ky, this.fromBase.z + (bowl.home.z - this.fromBase.z) * kb);
        }
        if (k >= 1) {
          this.phase = 'done';
          bowl.setLevel(0.003, true); // it has eased most of the way already; land on it exactly
          this.land(0.06).then(() => this.leaveDone?.());
        }
        break;
      }
      default:
        break;
    }
    if (this.phase === 'rest' && this.tilt === 0 && this.base.equals(bowl.home)) return;
    this.pose();
  }

  /** How far the lip has followed the pour through (0 at a full bowl's tilt, 1 from LIP_SINK_AT on). */
  private follow() { return THREE.MathUtils.clamp((this.tilt - TILT_FULL) / (LIP_SINK_AT - TILT_FULL), 0, 1); }

  /** Pivot the bowl about its lip: the lip is at base + lip, and the bowl turns about it. */
  private pose() {
    const { bowl } = this.ctx;
    this.q.setFromAxisAngle(this.X, this.tilt);
    bowl.group.quaternion.copy(this.q);
    // position = (base + lip) - R·lip
    bowl.group.position.copy(this.base).add(bowl.lip).sub(this.v.copy(bowl.lip).applyQuaternion(this.q));
  }

  /** Set down on the counter: a soft clunk and a little squash. */
  private land(amt: number) {
    const { bowl } = this.ctx;
    this.tilt = 0;
    this.base.copy(bowl.home);
    this.pose();
    sound.play('drop', { gain: 0.55, rate: 0.85 }); // a heavy ceramic bowl back on the wood
    return motion.squash(bowl.group, amt, 0.25);
  }

  /** The pan's batter: a mound that spreads to the paper, then a level that rises to the seam and past it. */
  private fillPan(dt: number, landing: number) {
    const { pan } = this.ctx;
    const p = this.poured;
    this.spread = Math.min(1, p / SPREAD_AT);
    // the level reaches the seam at the start of "just right" and rises slowly after
    const sw = this.meter.sweet[0];
    const full = p <= sw ? PAN.seamLevel * (p / sw) : PAN.seamLevel + (PAN.maxLevel - PAN.seamLevel) * ((p - sw) / (1 - sw));
    this.panLevel = full * this.spread * this.spread; // while it spreads, the batter goes outward, not up
    const r = MOUND_R0 + (PAN.fillR - MOUND_R0) * this.spread;
    // The puddle starts where the stream lands and drifts to the middle as it spreads.
    const lx = this.stream.landing.x - pan.position.x, lz = this.stream.landing.z - pan.position.z;
    if (this.stream.active && this.spread < 1) {
      this.centre.set(lx, lz).multiplyScalar(1 - this.spread);
      const lim = PAN.fillR - r;
      if (this.centre.length() > lim) this.centre.setLength(lim);
    } else if (this.spread >= 1) this.centre.set(0, 0);
    const soft = this.soft;
    soft.radius = r;
    soft.mesh.visible = p > 0.002;
    soft.mesh.position.set(this.centre.x, PAN.floorY + this.panLevel + 0.0008, this.centre.y);
    if (landing > 0.01) {
      // A grows with the flow: a tall dome while it is a puddle, a 5 mm mound once it fills the pan
      const amp = Math.sqrt(landing) * (0.005 + 0.007 * (1 - this.spread)); // a trickle still heaps a little
      soft.pourAt(this.stream.landing, landing, dt, this.batter, amp);
    }
    // the body under the top, once the batter reaches the paper all round
    const h = Math.max(0.001, this.panLevel - 0.0015);
    this.fill.visible = this.spread >= 1;
    this.fill.scale.set(1, h, 1);
    this.fill.position.y = PAN.floorY + h / 2;
    // poured too long: the batter thickens and darkens round the collar instead of spilling
    const over = THREE.MathUtils.smoothstep(p, LIP_FROM, 1);
    const lipH = LIP_H * over;
    this.lip.visible = lipH > 0.0003 && this.fill.visible;
    this.lip.scale.set(1, Math.max(lipH, 1e-5) / h, 1);
    soft.mat.color.setScalar(1 - 0.08 * over);
    this.fillMat.color.set(this.batter).multiplyScalar(1 - 0.08 * over);
    for (const b of this.berries) if (b.state === 'in') this.placeInFill(b);
  }

  // ---- berries ---------------------------------------------------------------------------

  private berriesLeft() {
    return this.ctx.bowl.contents.children.some((c) => c.name === 'berry') || this.berries.some((b) => b.state !== 'in');
  }

  /**
   * Embedded berries tip with the bowl. Once the batter falls away from one it rolls down
   * to the lip and is thrown off it with the stream; in the pan it lands on the batter
   * (a Rapier ball on a kinematic floor at the fill's height), plops, and settles in.
   */
  private updateBerries(dt: number) {
    const { bowl } = this.ctx;
    const leaving = new Set(this.berries.map((b) => b.mesh));
    const inBowl = (bowl.contents.children.filter((c) => c.name === 'berry') as THREE.Mesh[]).filter((m) => !leaving.has(m));
    // still in the batter: they sink with the level, never float above it
    const top = bowl.floorY + bowl.level - 0.002;
    for (const m of inBowl) m.position.y = Math.max(bowl.floorY + BERRY_R * 0.6, Math.min(m.position.y, top));
    const tipping = (this.phase === 'pour' || this.phase === 'leave') && this.tilt > 0.3;
    this.launchT -= dt;
    this.plipT += dt;
    if (tipping && this.spread >= 1 && inBowl.length && this.launchT <= 0) {
      // the first one the batter has left, or (once the pour is over) any, one at a time
      const next = inBowl.find((m) => bowl.uncovered(m.position, -BERRY_R * 0.3)) ?? (this.phase === 'leave' ? inBowl[0] : undefined);
      if (next) {
        this.launchT = this.phase === 'leave' ? 0.05 : 0.09;
        this.berries.push({ mesh: next, state: 'travel', t: 0, from: next.position.clone(), body: null, y: 0 });
      }
    }
    const fillTop = this.ctx.pan.position.y + PAN.floorY + this.panLevel;
    if (this.floorBody) {
      const p = this.ctx.pan.position;
      this.floorBody.setNextKinematicTranslation({ x: p.x, y: fillTop - 0.004, z: p.z });
    }
    let air = 0;
    for (const b of this.berries) {
      b.t += dt;
      if (b.state === 'travel') {
        // roll round the inside of the wall to the lip, speeding up as it goes
        const u = Math.min(1, b.t / TRAVEL_T);
        const e = u * u;
        const a0 = Math.atan2(b.from.x, b.from.z);
        const h0 = b.from.y, h1 = bowl.lip.y + BERRY_R * 0.4;
        const h = h0 + (h1 - h0) * e;
        const r0 = Math.hypot(b.from.x, b.from.z);
        const r = r0 + (bowl.radiusAt(h - bowl.floorY) - BERRY_R * 0.8 - r0) * e;
        const a = a0 * (1 - e);
        b.mesh.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
        b.mesh.rotation.x += dt * 14;
        if (u >= 1) this.launch(b);
      } else if (b.state === 'fly' && b.body) {
        const t = b.body.translation(), r = b.body.rotation();
        b.mesh.position.set(t.x, t.y, t.z);
        b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
        const pp = this.ctx.pan.position;
        const d = Math.hypot(t.x - pp.x, t.z - pp.z);
        if (t.y - BERRY_R <= fillTop + 0.0015 && d < PAN.fillR) this.berryLanded(b);
        else if (t.y < pp.y + 0.055 && d >= PAN.fillR - BERRY_R) this.settle(b); // never happens in play: it goes in the pan, never on the counter
        else air++;
      } else if (b.state === 'landed' && b.t > 0.12) this.settle(b);
    }
    this.dbg.berriesAir = air;
  }

  private launch(b: PanBerry) {
    const { k, bowl } = this.ctx;
    k.scene.attach(b.mesh);
    const p = b.mesh.position;
    if (!this.floorBody) {
      const pp = this.ctx.pan.position;
      this.floorBody = k.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pp.x, pp.y + PAN.floorY + this.panLevel - 0.004, pp.z));
      k.world.createCollider(RAPIER.ColliderDesc.cylinder(0.004, PAN.fillR - 0.002).setFriction(1.2).setRestitution(0.12), this.floorBody);
    }
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setLinearDamping(0.3).setAngularDamping(0.6).setCcdEnabled(true));
    k.world.createCollider(RAPIER.ColliderDesc.ball(BERRY_R).setRestitution(0.25).setFriction(0.8).setDensity(600), body);
    // thrown with the stream: off the lip along its downhill tangent
    const v = this.stream.active ? this.stream.velocityAt(0, this.v) : this.v.set(0, 0, 1).applyQuaternion(bowl.group.quaternion).multiplyScalar(0.12);
    body.setLinvel({ x: v.x * 1.1, y: v.y, z: v.z * 1.1 }, true);
    body.setAngvel({ x: 12, y: 0, z: (Math.random() - 0.5) * 6 }, true);
    b.body = body;
    b.state = 'fly';
    b.t = 0;
  }

  private berryLanded(b: PanBerry) {
    if (!b.body) return;
    const lv = b.body.linvel();
    const s = THREE.MathUtils.clamp(Math.hypot(lv.x, lv.y, lv.z), 0, 1.5);
    b.state = 'landed';
    b.t = 0;
    this.soft.ripple(b.mesh.position, 0.25 + 0.6 * s, 0.9);
    this.soft.dimple(b.mesh.position, 0.0015 + 0.002 * s);
    if (this.plipT >= PLIP_GAP) { this.plipT = 0; sound.play('berry', { gain: THREE.MathUtils.clamp(0.1 + 0.45 * s, 0.1, 0.7), rate: 1.3 + Math.random() * 0.3 }); }
  }

  /** A berry comes to rest in the batter: no body, a child of the fill just under its top. */
  private settle(b: PanBerry) {
    const { k, pan } = this.ctx;
    if (b.body) { k.world.removeRigidBody(b.body); b.body = null; }
    const p = this.w.copy(b.mesh.position).sub(pan.position);
    // the spreading batter carries it a little way from where it landed (up to 3.5 cm),
    // so the berries end up scattered rather than heaped under the stream
    const a = Math.random() * Math.PI * 2, d = 0.035 * Math.sqrt(Math.random());
    p.x += Math.cos(a) * d;
    p.z += Math.sin(a) * d;
    // inside the fill's edge, and not inside another berry
    const maxR = PAN.fillR - BERRY_R * 1.5;
    for (let pass = 0; pass < 3; pass++) {
      for (const o of this.berries) {
        if (o === b || o.state !== 'in') continue;
        const dx = p.x - o.mesh.position.x, dz = p.z - o.mesh.position.z;
        const dd = Math.hypot(dx, dz);
        if (dd < BERRY_R * 1.9) {
          if (dd < 1e-4) p.x += BERRY_R * 1.9;
          else { const push = (BERRY_R * 1.9 - dd) / dd; p.x += dx * push; p.z += dz * push; }
        }
      }
      const r = Math.hypot(p.x, p.z);
      if (r > maxR) { p.x *= maxR / r; p.z *= maxR / r; }
    }
    this.fill.add(b.mesh);
    // upright: under the fill's squashed scale a turned sphere would shear into a spike
    b.mesh.quaternion.identity();
    b.mesh.position.set(p.x, 0, p.z);
    b.state = 'in';
    this.placeInFill(b);
  }

  /** Keep a settled berry just under the batter's top, at its true size, whatever the fill's height. */
  private placeInFill(b: PanBerry) {
    const f = this.fill;
    const sy = Math.max(f.scale.y, 1e-4);
    b.mesh.position.y = (PAN.floorY + this.panLevel - BERRY_SINK - f.position.y) / sy;
    b.mesh.scale.set(1, 1 / sy, 1);
  }

  private finish() {
    if (this.finished) return;
    this.finished = true;
    this.holding = false;
    this.ctx.bowl.smear(); // what is left eases to a thin coat by the time it is set down
    if (this.phase === 'lift' || this.phase === 'pour' || this.phase === 'return') this.go('leave');
    else { this.phase = 'done'; this.leaveDone?.(); }
    this.ctx.done(this.meter.result());
  }

  /** The bowl rolls its last berries out, tips back and is set down; the pan is filled. */
  leave() { return this.left; }

  dispose() {
    const { k, pan } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    this.stream.dispose(k.scene);
    this.loop?.stop();
    // Anything still on its way goes in the pan; no body outlives the Step.
    for (const b of this.berries) if (b.state !== 'in') { if (b.state === 'travel') k.scene.attach(b.mesh); this.settle(b); }
    if (this.floorBody) { k.world.removeRigidBody(this.floorBody); this.floorBody = null; }
    // Hand the pan's batter to the plain fill the bake puffs up: same height, same colour.
    this.panLevel = Math.max(this.panLevel, 0.004);
    const h = this.panLevel;
    this.fill.visible = true;
    this.fill.scale.set(1, h, 1);
    this.fill.position.y = PAN.floorY + h / 2;
    const over = THREE.MathUtils.smoothstep(this.poured, LIP_FROM, 1);
    this.lip.scale.set(1, Math.max(LIP_H * over, 1e-5) / h, 1);
    for (const b of this.berries) if (b.state === 'in') this.placeInFill(b);
    pan.remove(this.soft.mesh);
    this.soft.mesh.geometry.dispose();
    this.soft.mat.dispose();
  }

  /** The finger cue goes on the bowl. */
  cue() {
    const { bowl } = this.ctx;
    return this.phase === 'rest' ? { name: 'bowl', at: bowl.group.position.clone().setY(bowl.group.position.y + 0.05) } : null;
  }

  focus() {
    return this.phase === 'rest' || this.phase === 'done' ? null : this.ctx.bowl.group; // off its spot: lifted, tipped or on its way back
  }

  targets() {
    const { pan, cat, bowl } = this.ctx;
    const out: Record<string, THREE.Vector3> = {
      anywhere: pan.position.clone(),
      bowl: bowl.group.position.clone().setY(bowl.group.position.y + 0.05),
      pan: pan.position.clone(),
      catHead: cat.headSide().sub(new THREE.Vector3(0.03, 0.01, 0)),
      // the back of the seam, which shows over the front of the collar
      seam: pan.position.clone().add(seamPoint(-Math.PI / 2)),
    };
    if (this.stream.active) out.landing = this.stream.landing.clone();
    return out;
  }

  progress() { return { progress: this.meter.progress, stage: this.phase === 'done' ? 'done' : this.finished ? 'leaving' : this.holding ? 'pouring' : 'idle' }; }

  meterInfo() { return { duration: this.meter.duration, sweet: this.meter.sweet }; }

  debug() {
    const { bowl, pan, k } = this.ctx;
    const surf = bowl.surfaceInfo();
    const land = this.stream.landing;
    const lip = bowl.lipWorld(new THREE.Vector3());
    let strays = 0, bodies = 0;
    k.world.forEachRigidBody((b) => {
      if (!b.isDynamic()) return;
      const t = b.translation();
      const inPan = Math.hypot(t.x - pan.position.x, t.z - pan.position.z) < 0.09;
      const inBowl = Math.hypot(t.x - bowl.group.position.x, t.z - bowl.group.position.z) < 0.15 || Math.hypot(t.x - bowl.home.x, t.z - bowl.home.z) < 0.14;
      if (t.y > 0.06 + pan.position.y && !inPan && !inBowl) strays++;
      if (this.berries.some((x) => x.body === b)) bodies++;
    });
    return {
      phase: this.phase, holding: this.holding, panArrived: this.panArrived, streamFlow: this.stream.flow,
      streamActive: this.stream.active, landedFraction: this.stream.landedFraction,
      tilt: this.tilt, poured: this.poured,
      fillHeight: this.panLevel, panLevel: this.panLevel, panRadius: this.soft.radius, spread: this.spread,
      // how far the pan's top stands over its level where the stream lands (the mound)
      panRise: this.stream.active ? this.soft.heightAt(land, 0) : 0,
      landInPan: Math.hypot(land.x - pan.position.x, land.z - pan.position.z) < PAN.fillR,
      lipErr: this.stream.active ? this.stream.from.distanceTo(lip) : 0,
      arc: Math.hypot(land.x - lip.x, land.z - lip.z), lipHeight: lip.y - (pan.position.y + PAN.floorY),
      surfUpDeg: surf.upDeg, surfShift: surf.shift, surfVisible: surf.visible, bowlLevel: surf.level, bowlOpacity: surf.opacity,
      bowlBerries: bowl.contents.children.filter((c) => c.name === 'berry').length,
      panBerries: this.fill.children.filter((c) => c.name === 'berry').length,
      berryBodies: bodies, strays,
      lip: this.lip.visible ? this.lip.scale.y * this.fill.scale.y : 0,
      ...this.dbg,
    };
  }
}

export { FLAVOR_TINT };

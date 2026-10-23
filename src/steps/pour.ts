// Step: pour in the cream, then the flour, then the flavour's add-in. Press and hold the
// jug (or cup, dish, lemon): it swings over the bowl on a spring (level, with a little
// bounce) and tips about its lip. The finger is the hand: slide it down and the vessel tips
// further and pours harder (a thin trickle to a glug), slide it up and it tips back until
// the flow stops; slide it sideways and the vessel follows. The meter fills with what
// actually pours, so a gentle tip is slow and a steep one is quick. Let go and the flow
// stops first (the last of it falls, a drip or two), then it tips back and is carried home.
// Each thing pours the way it really does:
//   cream   a stream off the jug's spout (Stream) with beads and splashes (Droplets);
//   flour   a soft cloud sifting off the cup's lip (Sift), dusting the batter, never a rod;
//   berries real little balls (Rapier) that roll out of the tipped dish, plop in, sink;
//   lemon   the half held tipped toward you and squeezed in pulses: drops, a short thread.
// Only one pourable is ever on the counter: each one slides in from the right, does its
// job at the front slot, and slides off to the left before the next one arrives.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { SLOT } from '../kitchen';
import { HoldMeter, pauseEnds } from '../gestures';
import { Stream } from '../stream';
import { Droplets } from '../droplets';
import { Sift } from '../sift';
import { ParticlePool } from '../particles';
import { motion, Spring, easeInOutCubic } from '../motion';
import { makeJug, makeCup, makeBerryDish, makeBerry, makeLemon, lipOf, setPourState, setSqueeze, squeezeOf, BERRY_R, DISH } from '../props';
import { sound, type Loop, type LoopName } from '../sound';
import type { PointerHandler } from '../input';
import type { StepContext, StepRunner } from './step';

/** waiting: hidden off to the right; arriving: sliding in; active: the one you pour; leaving: sliding off left. */
type PourableState = 'waiting' | 'arriving' | 'active' | 'leaving' | 'gone';
/** rest: on the counter; carry: held (carried over, then tipped); untilt: tipping back; home: carried back. */
type Phase = 'rest' | 'carry' | 'untilt' | 'home';

interface Pourable {
  name: string;
  obj: THREE.Group;
  kind: 'liquid' | 'flour' | 'berries' | 'lemon';
  stream: number;      // colour
  radius: number;      // stream radius at the lip
  level: number;       // how much a full meter raises the bowl
  loop: LoopName | null;
  tint?: number;       // colour it spreads through the batter
  /** Tip about z (spout on +x goes down) or about x (the lemon, its cut face turned toward you). */
  axis: 'z' | 'x';
  /**
   * The tilt a still finger holds it at, at the start and at the end of the pour: it has to
   * tip further as it empties for the same flow.
   */
  tilts: [number, number];
  /** rad of extra tip from the first trickle to a full glug (how touchy the vessel is). */
  span: number;
  state: PourableState;
  // ---- the hand, per vessel (one can be going home while the next waits) ----
  lip: THREE.Vector3;       // local
  phase: Phase;
  lift: Spring;             // blend rest -> hover: a spring, so it swings over and settles
  liftK: number;            // its value now
  tiltS: Spring;            // tilt (rad), chasing what the finger asks for
  tilt: number;             // radians now
  hoverLip: THREE.Vector3;  // world, where the lip pours from (moves with the finger and the tilt)
  /** The vessel's box in its own frame, upright (for keeping its lowest point over the rim). */
  box: THREE.Box3 | null;
  yaw: number;              // rad about y now: a jug turns its spout to face the bowl as it is lifted
  follow: Spring;           // m the finger has slid it sideways (along the rim for a jug)
  onHome: (() => void) | null;
  emptied: number;          // 0..1, how much of it has been poured
}

/**
 * A blueberry. kept: a child of the dish, no body (while the dish is carried, so a quick
 * carry never flings them out); free: a Rapier ball; landed: it has touched the batter
 * and is sinking; embedded: a mesh in the bowl's contents, its body gone.
 */
interface Berry {
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody | null;
  state: 'kept' | 'free' | 'landed' | 'embedded';
  t: number;      // s since it landed
  speed: number;  // m/s last frame, the speed it hits with
  rate: number;   // its own pitch for the plip
}

const WINGS = 0.35;      // how far off to the side a pourable waits and leaves (off screen at every viewport)
const SLIDE = 0.4;       // s, in and out
const GAP = 0.15;        // s between one having left and the next appearing
const POP_AFTER = 0.9;   // s after letting go of the last one before it pops away
// The hand's springs (tuned by eye): the swing over overshoots a touch like a real arm, the
// tilt follows the finger quickly but never snaps, the tip back and the carry home are firm.
const LIFT_K = 90, LIFT_Z = 0.7;
const TILT_K = 90, TILT_Z = 0.85;
const BACK_K = 220, BACK_Z = 1;
const HOME_K = 260, HOME_Z = 1;
const TIP_AT = 0.9;      // it only tips once it is this far over (it moves level until then)
const HOP = 0.11;        // m the carry rises at its middle: a jug's bottom clears the near rim
// Where a jug, cup or dish is held: as a hand holds it, beside the bowl with its spout just over
// the far-right rim, turned to face the middle (and the camera), its body out over the counter
// behind the bowl (away from the cat on the left), so the stream falls in full view in front of
// it. The lip rides LIP_UP over the rim plane while it pours, so the stream falls ~10 cm into
// the batter; while it is still level it is held higher, so no part of it ever dips into the bowl.
const RIM_ANG = -0.95;   // rad round the bowl from +x (positive toward the camera): back-right (tuned by eye on a phone)
const ANG_MIN = -1.1, ANG_MAX = -0.8; // how far round the rim the finger can slide it (on a phone screen, off the cat)
const LIP_IN = 0.026;    // m the lip sits inside the rim's inner edge: the pour lands well inside the batter
const LIP_UP = 0.03;     // m over the rim plane the lip pours from
const CLEAR = 0.01;      // m the vessel's lowest point stays over the rim plane
const FOLLOW = 0.05;     // m the vessel follows the finger sideways
const TIP_PX = 110;      // px of finger travel down from where it pressed, a trickle -> a full glug
const REST_FLOW = 0.6;   // the flow a still finger pours at (just holding still pours steadily)
const MAX_TIP = 1.2;     // the finger can tip it a little past full flow (the flow stays at 1)...
const MIN_TIP = -0.5;    // ...and back past the first trickle, so sliding up stops the pour
const SIFT_GAIN = 0.85 / REST_FLOW; // flour sifts as a cloud: a still finger already sifts a full-looking one
const GRAB_PX = 95;      // px: how close to the vessel a finger must land to pick it up (Carry's reach)
const GRAB_UP = 0.05;    // m over its base: aim at the vessel's middle, not its foot
const SPOUT_DROOP = 0.1; // rad the spout's channel points below the vessel's +x (tuned by eye)
// berries
const FEED_EVERY = 0.15; // s between handfuls fed in from the back of the dish while you hold
const MAX_BERRIES = 30;
const IN_DISH = 3;       // never more than this many loose in the dish, so it visibly empties
const SINK_AFTER = 0.3;  // s on the batter before a berry settles in
const BERRY_SINK = 0.003; // m a settled berry sits below the surface (it looks embedded)
// lemon
const SQUEEZE_HZ = 1.6;
const SQUEEZED = 0.72;   // axial scale at the bottom of a squeeze
const THREAD = 0.2;      // s of thin stream per squeeze before it breaks into drops
const LEMON_TINT = 0xf8ec9a;
// sound
const DRIP_GAP = 0.25;   // s: drops landing closer than this share one drip sound (a splash throws a dozen at once; a few soft drops a second, never a patter)
const TAIL_DRIPS = 3;    // drip sounds a cream pour gets once its tail lands (cream drops are heard 1-3 times, never under a running stream)
const PLIP_GAP = 0.03;   // s: berries landing in the same instant are heard as one plip, not a buzz
const BOWL_FULL = 0.074; // m of batter that would fill the bowl to under its rim (bowl.ts): the pour rings higher toward it

/** Each berry's own plip pitch: small and firm, so high (1.3-1.6, by ear). */
const berryRate = () => 1.3 + Math.random() * 0.3;

export class PourStep implements StepRunner, PointerHandler {
  private readonly items: Pourable[] = [];
  private index = 0;
  // full flow fills it in 1.8 s; a still finger (REST_FLOW) in 3 s, long enough to watch it go in
  private readonly meter = new HoldMeter(1.8, [0.5, 0.85]);
  /** 0..1, how hard the held vessel pours right now: how far past its pour point it is tipped. */
  private flow = 0;
  private holding = false;
  private readonly stream: Stream;
  private readonly drops: Droplets;
  private readonly sift: Sift;
  private readonly pips: ParticlePool;
  private loop: Loop | null = null;
  private finished = false;
  private restPos = new THREE.Vector3();
  private lastLeave: Promise<void> = Promise.resolve();
  /** The ring keeps showing how far the last vessel got until it is set down at home. */
  private ringHold: number | null = null;
  private readonly collisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => this.onCollision(a, b);
  private pointer = { x: 0, y: 0 };
  private downX = 0;   // world x under the finger when it went down
  private downY = 0;   // screen y where the finger went down: sliding down from it tips further
  private holdT = 0;   // game s since the finger went down
  private releasedFor = Infinity; // game s since the finger lifted
  private pausedFor = Infinity;   // game s the finger has been up mid-vessel (a lift is a pause, see pauseEnds)
  private pouredItem: Pourable | null = null; // the one whose stream is in the air
  private readonly lipNow = new THREE.Vector3();
  private readonly lipPrev = new THREE.Vector3();
  private lipSpeed = 0;
  // berries: the dish's kinematic body, the batter's kinematic floor, and every berry
  private berries: Berry[] = [];
  private readonly berryOf = new Map<number, Berry>(); // collider handle -> berry
  private dishBody: RAPIER.RigidBody | null = null;
  private floorBody: RAPIER.RigidBody | null = null;
  private floorCollider: RAPIER.Collider | null = null;
  private feedT = 0;
  private berriesStart = 0;
  private berriesLost = 0;
  private berriesAirMax = 0;
  // lemon
  private squeezeT = 0;
  private squeeze = 1;
  private squeezes = 0;
  private threadLeft = 0;
  private lemonRippleT = 0;
  private dripT = 0;
  private dripsLeft = 0;
  private plipT = 0;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private dbg: Record<string, unknown> = {};

  constructor(private readonly ctx: StepContext) {
    const { k, bowl } = ctx;
    this.stream = new Stream(k.scene, 0xfffaf2);
    this.stream.mode = 'surface';
    this.drops = new Droplets(k.scene, (x, y, z, size) => this.dropLanded(this.w.set(x, y, z), size));
    this.stream.onBreak = (from, to) => this.drops.breakUp(this.stream, from, to);
    // The cream's head hitting the batter splashes, and so does the last of it; the lemon's thread only drips.
    this.stream.onLand = (end) => {
      const kind = this.pouredItem?.kind;
      if (kind === 'liquid') {
        sound.play('splash', { gain: end === 'head' ? 0.55 : 0.35, rate: end === 'head' ? 1 : 1.15 });
        if (end === 'head') this.dripsLeft = 0; // a stream running in drowns its drops; once it stops, a few are heard
      }
      else if (kind === 'lemon') this.dripSound(0.1);
    };
    this.sift = new Sift(k.scene, 0xfffdf7, (p) => {
      // each flake is a share of the cup: it dusts the batter and raises it a hair
      const share = 1 / (Sift.RATE * this.meter.duration * SIFT_GAIN);
      bowl.dustAt(this.w.set(p.x, p.y, p.z), share, 0xfffdf7);
      const it = this.items.find((x) => x.kind === 'flour');
      if (it) bowl.addLevel(it.level * share);
    });
    const pipGeo = new THREE.SphereGeometry(1, 8, 6);
    pipGeo.scale(0.55, 1, 0.4);
    this.pips = new ParticlePool(pipGeo, new THREE.MeshStandardMaterial({ color: 0xfff3d2, roughness: 0.45 }), 4, {
      gravity: 9.81, floor: 'die', onLand: (p) => bowl.ripple(this.w.set(p.x, p.y, p.z), 0.35, 0.7),
    });
    k.scene.add(this.pips.mesh);
  }

  start() {
    const { k, hud, flavor, station } = this.ctx;
    this.restPos = k.at(SLOT.front, station);
    const add = (p: Pick<Pourable, 'name' | 'obj' | 'kind' | 'stream' | 'radius' | 'level' | 'loop' | 'tint'> & Partial<Pick<Pourable, 'axis' | 'tilts' | 'span'>>) => this.items.push({
      axis: 'z', tilts: [0.55, 1.3], span: 0.4, ...p,
      state: 'waiting', lip: lipOf(p.obj), phase: 'rest', lift: new Spring(0, LIFT_K, LIFT_Z), liftK: 0, tiltS: new Spring(0, TILT_K, TILT_Z), tilt: 0,
      hoverLip: new THREE.Vector3(), box: null, yaw: 0, follow: new Spring(0, 140, 0.8), onHome: null, emptied: 0,
    });
    add({ name: 'cream', obj: makeJug(), kind: 'liquid', stream: 0xfffaf2, radius: 0.0075, level: 0.022, loop: 'pour', tint: 0xfff8ea });
    add({ name: 'flour', obj: makeCup(), kind: 'flour', stream: 0xfffdf7, radius: 0, level: 0.012, loop: 'flour', tint: 0xfff7e4 });
    // The dish tips much further than a jug: berries only roll over its low ring past ~76° (see DISH).
    if (flavor.addIn === 'berries') add({ name: 'blueberries', obj: makeBerryDish(), kind: 'berries', stream: 0, radius: 0, level: 0.004, loop: null, tilts: [1.4, 1.85], span: 0.3 });
    // The half is held tipped ~100° toward you (cut face to the camera, foreshortened), its rim the drip point.
    if (flavor.addIn === 'lemon') add({ name: 'lemon', obj: makeLemon(), kind: 'lemon', stream: 0xfbf3a8, radius: 0.0007, level: 0.004, loop: null, tint: LEMON_TINT, axis: 'x', tilts: [1.75, 1.85], span: 0.2 });
    for (const it of this.items) {
      it.obj.position.copy(this.restPos).add(new THREE.Vector3(WINGS, 0, 0));
      it.obj.visible = false;
      k.scene.add(it.obj);
    }
    const arrived = this.arrive(this.items[0]);
    k.pointer.handlers.unshift(this);
    k.onCollision.add(this.collisionHandler);
    hud.meter('ring');
    hud.setRing(0, this.meter.sweet);
    hud.setPips(this.items.length, 0);
    this.hintFor();
    return arrived;
  }

  private get item() { return this.items[this.index]; }

  private hintFor() {
    const names: Record<string, string> = { cream: 'jug', flour: 'cup', blueberries: 'dish', lemon: 'lemon' };
    this.ctx.hud.hint(`Press and hold the ${names[this.item.name]}, slide down to tip`); // breaks after the comma, never mid-phrase
  }

  /** Slide a pourable in from the right wing to the front slot. */
  private arrive(it: Pourable) {
    it.state = 'arriving';
    it.obj.visible = true;
    it.obj.rotation.set(0, 0, 0);
    return this.ctx.k.glide(it.obj, this.restPos, SLIDE).then(() => {
      if (it.state !== 'arriving') return;
      it.state = 'active';
      if (it.kind === 'berries') this.setupBerries(it);
    });
  }

  /** Slide a finished pourable off to the left wing, then hide it. It is upright and home by now. */
  private depart(it: Pourable) {
    it.state = 'leaving';
    it.obj.rotation.set(0, 0, 0);
    const to = this.restPos.clone().add(new THREE.Vector3(-WINGS, 0, 0));
    return this.ctx.k.glide(it.obj, to, SLIDE).then(() => { it.state = 'gone'; it.obj.visible = false; });
  }

  /** The last pourable, home and upright, swells and pops away at the front slot. */
  private async popAway(it: Pourable) {
    // ...once the last of what it poured has landed and sunk in (the berries settle by 0.55 s)
    await motion.delay(Math.max(0, POP_AFTER - this.releasedFor));
    it.state = 'leaving';
    await motion.popOut(it.obj, 0.22);
    it.state = 'gone';
    it.obj.visible = false;
  }

  // ---- input ---------------------------------------------------------------------------

  /** Is a finger at (x, y) on the vessel: where it stands now (carried or not) or its spot on the counter. */
  private onVessel(it: Pourable, x: number, y: number) {
    const { k } = this.ctx;
    if (it.state === 'waiting' || it.state === 'gone' || it.state === 'leaving') return false;
    const now = this.w.copy(it.obj.position).setY(it.obj.position.y + GRAB_UP);
    const home = this.v.copy(this.restPos).setY(this.restPos.y + GRAB_UP);
    return Math.min(k.screenDist(x, y, now), k.screenDist(x, y, home)) < GRAB_PX;
  }

  down(x: number, y: number) {
    if (this.finished) return false;
    const it = this.item;
    // Only a finger on the vessel picks it up; anywhere else is a Nudge.
    if (!this.onVessel(it, x, y)) return false;
    this.holding = true;
    this.holdT = 0;
    this.releasedFor = Infinity;
    this.pausedFor = Infinity;
    this.pointer = { x, y };
    this.downY = y;
    if (it.loop) this.loop ??= sound.loop(it.loop);
    return true;
  }

  move(x: number, y: number) { this.pointer = { x, y }; }

  up() {
    if (!this.holding) return;
    this.holding = false;
    this.release(this.item);
    this.pausedFor = 0;
    if (this.meter.progress < this.meter.sweet[0]) this.ctx.hud.hint('Pick it up again, a little more!');
  }

  /** Pick the vessel up (or catch it again on its way back). */
  private grab(it: Pourable) {
    const { k } = this.ctx;
    if (it.phase === 'rest') {
      if (!it.box) {
        // its upright box in its own frame (it stands at rest, unturned, right now)
        it.obj.rotation.set(0, 0, 0);
        it.obj.updateMatrixWorld(true);
        it.box = new THREE.Box3().setFromObject(it.obj, true).translate(this.w.copy(it.obj.position).negate());
      }
      it.follow.jump(0);
      it.lift.jump(0);
      it.tiltS.jump(0);
      // lifted off the counter: the flour cup tinks, the rest are a soft grab
      if (it.kind === 'flour') sound.play('tink', { gain: 0.35, rate: 1.1 });
      else sound.play('grab', { gain: it.kind === 'liquid' ? 0.4 : 0.25, rate: it.kind === 'lemon' ? 1.2 : 1 });
    } else {
      // caught on the way back: the springs carry on from where it is
      it.follow.set(it.follow.value);
    }
    it.phase = 'carry';
    it.lift.stiffness = LIFT_K; it.lift.dampingRatio = LIFT_Z;
    it.tiltS.stiffness = TILT_K; it.tiltS.dampingRatio = TILT_Z;
    if (it.kind === 'berries') this.keepBerries(it); // they ride in the dish while it is carried
    this.hoverTarget(it);
    const f = k.fingerAt(this.pointer.x, this.pointer.y, it.hoverLip.y);
    this.downX = (f?.x ?? 0) - it.follow.value;
  }

  /** Stop the flow (the last of it falls), then tip back and carry home. */
  private release(it: Pourable) {
    if (it.phase !== 'carry') return;
    this.flow = 0;
    if (this.stream.flow > 0) {
      this.stream.flow = 0;
      if (it.kind === 'liquid' || it.kind === 'lemon') this.drops.drip(() => this.lipNow);
      if (it.kind === 'liquid') this.dripsLeft = TAIL_DRIPS;
    }
    this.sift.flow = 0;
    this.threadLeft = 0;
    if (it.kind === 'berries') this.keepBerries(it);
    it.phase = 'untilt';
    it.follow.set(0); // the finger no longer steers it: it drifts back to where it was picked up to pour
    it.tiltS.stiffness = BACK_K; it.tiltS.dampingRatio = BACK_Z;
    this.releasedFor = 0;
  }

  private next() {
    const it = this.item;
    const result = this.meter.result();
    this.ctx.hud.setPips(this.items.length, this.index + 1);
    if (it.kind === 'berries') this.endBerries();
    // It finishes going home, then slides off; the next one waits for that.
    const home = new Promise<void>((resolve) => {
      if (it.phase === 'rest') resolve(); else it.onHome = resolve;
    });
    // The last one has nowhere to make room for: it pops away where it stands.
    const last = this.index + 1 >= this.items.length;
    this.lastLeave = home.then(() => (last ? this.popAway(it) : this.depart(it)));
    this.holding = false;
    this.ringHold = this.meter.progress;
    this.meter.progress = 0;
    if (this.index + 1 >= this.items.length) { this.finished = true; this.ctx.done(result); return; }
    this.index++;
    const nextItem = this.item;
    this.lastLeave.then(() => motion.delay(GAP)).then(() => this.arrive(nextItem));
    // The ring empties and the hint names the next vessel once this one is set down, not mid tip-back.
    home.then(() => { this.ringHold = null; if (!this.finished) this.hintFor(); });
  }

  // ---- per frame -------------------------------------------------------------------------

  update(dt: number, t: number) {
    const { bowl, hud } = this.ctx;
    this.holdT += dt;
    this.dripT += dt;
    this.plipT += dt;
    if (this.releasedFor !== Infinity) this.releasedFor += dt;
    if (!this.holding && !this.finished && this.pausedFor !== Infinity) {
      this.pausedFor += dt;
      if (this.pausedFor >= pauseEnds(this.meter.progress, this.meter.sweet, 0.25)) { this.pausedFor = Infinity; this.next(); }
    }
    const it = this.item;
    // A finger that went down while the vessel was still sliding in picks it up once it is here.
    if (this.holding && it.state === 'active' && it.phase !== 'carry') this.grab(it);
    for (const x of this.items) if (x.state === 'active') this.choreograph(x, dt);

    // How hard it pours: how far past its pour point the finger has tipped it.
    const target = this.pourPoint(it);
    const over = it.state === 'active' && it.phase === 'carry' && it.liftK > TIP_AT;
    this.flow = over && this.holding && !this.finished ? THREE.MathUtils.clamp((it.tilt - target) / it.span, 0, 1) : 0;
    const flow = this.flow;
    const pouring = flow > 0.02;

    if (pouring) {
      // the meter fills with what actually goes in: for the cream, what lands (its head is still falling at first)
      this.meter.advance(dt, it.kind === 'liquid' ? this.stream.landingFlow : flow);
      // the cat leans in to watch it go in
      this.ctx.cat.leanTo(this.stream.active ? this.stream.landing : it.obj.position, 0.8);
      if (it.kind === 'liquid' || it.kind === 'lemon') this.aimStream(it);
      // the stream and the cloud chase the flow: a jug never jumps from a trickle to a glug
      const chase = (v: number, rate: number) => v + (flow - v) * (1 - Math.exp(-rate * dt));
      if (it.kind === 'liquid') {
        this.stream.flow = chase(this.stream.flow, 10);
        // a trickle is a 6 mm thread, a glug a 12 mm rope (radius at the lip)
        this.stream.radius = it.radius * (0.8 + 0.8 * this.stream.flow);
      }
      if (it.kind === 'flour') this.sift.flow += (Math.min(1, flow * SIFT_GAIN) - this.sift.flow) * (1 - Math.exp(-8 * dt));
      if (it.kind === 'berries') { this.feedBerries(it, dt * flow / REST_FLOW); bowl.addLevel((it.level / this.meter.duration) * flow * dt); }
      if (it.kind === 'lemon') { this.squeezeLemon(it, dt * flow / REST_FLOW); bowl.addLevel((it.level / this.meter.duration) * flow * dt); }
      if (it.name === 'cream') this.dissolveYolks(dt);
      if (this.meter.progress >= 1) { this.holding = false; this.pausedFor = Infinity; this.release(it); this.next(); }
    } else if (this.holding && it.phase === 'carry') {
      // tipped back under its pour point: the flow stops (what is in the air still falls, a drip or two)
      if (it.kind === 'liquid' && this.stream.flow > 0) { this.stream.flow = 0; this.drops.drip(() => this.lipNow); this.dripsLeft = TAIL_DRIPS; }
      this.sift.flow = 0;
    }
    if (!pouring && it.kind === 'lemon') {
      // let go: the half springs back to its shape
      this.squeeze += (1 - this.squeeze) * (1 - Math.exp(-14 * dt));
      setSqueeze(it.obj, this.squeeze);
    }

    // The stream falls from wherever the poured vessel's lip is, along its spout.
    const src = this.pouredItem;
    if (src && src.state === 'active') {
      this.lipOf(src, this.lipNow);
      this.stream.from.copy(this.lipNow);
      this.spoutDir(src, this.stream.dir);
    }
    this.stream.surfaceY = bowl.surfaceY();
    this.stream.update(t, dt);
    // The bowl hears the landing: a mound, rings, foam, colour, and the level rises with the flow.
    const landing = this.stream.landingFlow;
    if (this.stream.active && landing > 0 && src) {
      if (src.kind === 'liquid') {
        bowl.pourAt(this.stream.landing, landing, dt, src.tint);
        bowl.addLevel((src.level / this.meter.duration) * landing * dt);
      } else {
        // the lemon's thread: a hairline, so only a faint ring and a spreading yellow
        bowl.tintSpot(this.stream.landing, LEMON_TINT, dt * 1.5);
        this.lemonRippleT -= dt;
        if (this.lemonRippleT <= 0) { this.lemonRippleT = 0.1; bowl.ripple(this.stream.landing, 0.15, 0.6); }
      }
    }
    this.lipSpeed = this.stream.active ? Math.min(1, this.lipPrev.distanceTo(this.lipNow) / Math.max(dt, 1e-4)) : 0;
    this.lipPrev.copy(this.lipNow);
    this.drops.update(dt, this.stream, bowl.surfaceY(), this.lipSpeed);
    this.pips.floorY = bowl.surfaceY();
    this.pips.update(dt);

    // Flour: the cloud sifts from the cup's lip, never as a stream.
    const cup = this.items.find((x) => x.kind === 'flour');
    if (cup && cup.state === 'active') {
      this.lipOf(cup, this.sift.from);
      this.spoutDir(cup, this.sift.dir);
    }
    this.sift.surfaceY = bowl.surfaceY();
    this.sift.update(dt);

    this.updateBerries(dt);

    // The pour sound is what lands: the cream's stream as it reaches the batter (silent until the
    // head lands, gone the moment the flow stops), ringing higher as the bowl fills; the flour's sifting.
    if (it.kind === 'liquid') this.loop?.set(this.stream.flow * this.stream.landedFraction, { fill: bowl.level / BOWL_FULL });
    else if (it.kind === 'flour') this.loop?.set(this.sift.intensity);
    else this.loop?.set(0);
    if (this.finished && !this.stream.active && this.loop) { this.loop.stop(); this.loop = null; }
    if (!this.holding && !this.stream.active && this.loop && this.releasedFor > 0.5) { this.loop.stop(); this.loop = null; }

    hud.setRing(this.ringHold ?? this.meter.progress, this.meter.sweet);
    this.measure(it, target);
  }

  /** Point the stream at this vessel the first time it pours. */
  private aimStream(it: Pourable) {
    if (this.pouredItem === it) return;
    this.pouredItem = it;
    this.stream.setColor(it.stream);
    this.drops.setColor(it.stream);
    this.stream.radius = it.radius;
    this.stream.ellipse = 1;
    // Cream is runny: its thread thins hard as it speeds up, spreads into a little puddle where
    // it lands, and when you stop, what is still in the air snaps into drops within a blink.
    this.stream.minTaper = 0.38; // thins as it falls, but stays a rope you can see, never a hairline
    this.stream.breakAfter = 0.06;
    this.stream.foot = it.kind === 'liquid';
    if (it.kind === 'lemon') {
      // juice is pale and see-through
      for (const m of [this.stream.mesh.material, this.drops.pool.mesh.material] as THREE.MeshStandardMaterial[]) {
        m.transparent = true;
        m.opacity = 0.7;
        m.depthWrite = false;
      }
    }
  }

  /** The tilt a still finger holds it at: further as it empties. */
  private restTilt(it: Pourable) {
    return THREE.MathUtils.lerp(it.tilts[0], it.tilts[1], it === this.item ? this.meter.progress : it.emptied);
  }

  /** The tilt of the first trickle: under it nothing runs over the lip. */
  private pourPoint(it: Pourable) { return this.restTilt(it) - REST_FLOW * it.span; }

  /** The tilt the finger asks for: sliding down from where it pressed tips further, up tips back. */
  private fingerTilt(it: Pourable) {
    const u = THREE.MathUtils.clamp(REST_FLOW + (this.pointer.y - this.downY) / TIP_PX, MIN_TIP, MAX_TIP);
    return this.pourPoint(it) + u * it.span;
  }

  /** Move one vessel through its carry, tip, tip-back and carry home, from its parameters. */
  private choreograph(it: Pourable, dt: number) {
    const held = it === this.item && this.holding;
    switch (it.phase) {
      case 'rest':
        it.lift.jump(0); it.tiltS.jump(0);
        break;
      case 'carry': {
        // Swing over the bowl; it moves level and only tips once nearly there, then the
        // finger holds the tilt.
        it.lift.set(1);
        it.tiltS.set(it.liftK > TIP_AT ? Math.max(0, this.fingerTilt(it)) : 0);
        if (held) {
          const f = this.ctx.k.fingerAt(this.pointer.x, this.pointer.y, it.hoverLip.y);
          if (f) it.follow.set(this.clampFollow(it, f.x - this.downX));
        }
        break;
      }
      case 'untilt':
        it.tiltS.set(0);
        if (it.tilt < 0.06) {
          it.phase = 'home';
          it.lift.stiffness = HOME_K; it.lift.dampingRatio = HOME_Z;
        }
        break;
      case 'home':
        it.tiltS.set(0);
        it.lift.set(0);
        if (it.liftK < 0.02) {
          it.phase = 'rest';
          it.lift.jump(0); it.tiltS.jump(0);
          motion.squash(it.obj, 0.1, 0.22); // set down on the counter
          sound.play('drop', { gain: it.kind === 'liquid' ? 0.35 : 0.25, rate: it.kind === 'flour' ? 1.3 : 1.1 });
          const done = it.onHome;
          it.onHome = null;
          done?.();
        }
        break;
    }
    if (it.phase !== 'rest') { it.lift.step(dt); it.tiltS.step(dt); }
    it.liftK = it.phase === 'home' ? Math.max(0, it.lift.value) : it.lift.value; // never into the counter
    it.tilt = Math.max(0, it.tiltS.value); // never tipped backwards
    it.follow.step(dt);
    this.place(it);
    if (it === this.item && !this.finished) it.emptied = Math.max(it.emptied, this.meter.progress);
    setPourState(it.obj, it.tilt, it.emptied);
  }

  /** Keep the lip (and so the landing) well inside the batter, whatever the finger does. */
  private clampFollow(it: Pourable, dx: number) {
    const { bowl } = this.ctx;
    const x = THREE.MathUtils.clamp(dx, -FOLLOW, FOLLOW);
    if (it.axis === 'z') return x; // round the rim: rimAngle keeps it between ANG_MIN and ANG_MAX
    // the lemon, over the middle: inside the batter's edge, with room to move even over its first few millimetres
    const maxR = Math.min(bowl.rimRadius - 0.03, Math.max(bowl.surfaceRadius() - 0.026, 0.045));
    const lim = Math.sqrt(Math.max(0, maxR * maxR - 0.02 * 0.02));
    return THREE.MathUtils.clamp(0.035 + x, -lim, lim) - 0.035;
  }

  /** How far round the rim (rad from +x toward the camera) a jug's lip is held: the finger slides it round. */
  private rimAngle(it: Pourable) {
    // dx = -r·sin(a)·da, so the lip moves the way the finger does
    return THREE.MathUtils.clamp(RIM_ANG - it.follow.value / (this.hoverRadius() * Math.sin(RIM_ANG)), ANG_MIN, ANG_MAX);
  }

  private hoverRadius() { const { bowl } = this.ctx; return bowl.radiusAt(bowl.rimY - bowl.floorY) - LIP_IN; }

  /**
   * The vessel's lowest point relative to its lip at its tilt now (m, negative is below), from
   * its upright box corners: conservative, no part of it is ever lower than this.
   */
  private lowest(it: Pourable) {
    if (!it.box) return -it.lip.y;
    this.q.setFromEuler(this.e.set(it.axis === 'x' ? it.tilt : 0, 0, it.axis === 'z' ? -it.tilt : 0));
    let low = Infinity;
    for (let i = 0; i < 8; i++) {
      this.w.set(i & 1 ? it.box.max.x : it.box.min.x, i & 2 ? it.box.max.y : it.box.min.y, i & 4 ? it.box.max.z : it.box.min.z)
        .sub(it.lip).applyQuaternion(this.q);
      low = Math.min(low, this.w.y);
    }
    return low;
  }

  /**
   * Where the lip is held now: a jug, cup or dish just inside the far-right rim, the lemon
   * over the middle; LIP_UP over the rim plane, or higher while it is still too level for its
   * bottom to clear the rim (so it dips its spout to the rim as it tips, as a hand does).
   */
  private hoverTarget(it: Pourable) {
    const { bowl } = this.ctx;
    if (it.axis === 'z') {
      const a = this.rimAngle(it), r = this.hoverRadius();
      it.hoverLip.set(bowl.home.x + Math.cos(a) * r, 0, bowl.home.z + Math.sin(a) * r);
    } else {
      it.hoverLip.set(bowl.home.x + 0.035 + it.follow.value, 0, bowl.home.z + 0.02);
    }
    it.hoverLip.y = bowl.home.y + bowl.rimY + Math.max(LIP_UP, CLEAR - this.lowest(it));
    return it.hoverLip;
  }

  /** Put the vessel where its lip should be, turned about the lip. */
  private place(it: Pourable) {
    const lip = this.v;
    const rest = this.restPos;
    const k = it.liftK;
    if (it.phase === 'rest') { it.obj.position.copy(rest); it.obj.rotation.set(0, 0, 0); it.yaw = 0; return; }
    const hover = this.hoverTarget(it);
    // The lip travels from where it sits at rest to the hover point, hopping over the rim.
    lip.set(
      rest.x + it.lip.x + (hover.x - rest.x - it.lip.x) * k,
      rest.y + it.lip.y + (hover.y - rest.y - it.lip.y) * k + HOP * Math.sin(Math.PI * THREE.MathUtils.clamp(k, 0, 1)),
      rest.z + it.lip.z + (hover.z - rest.z - it.lip.z) * k,
    );
    // On the way over a jug turns so its spout (+x) faces the bowl's middle.
    // (the short way round: π - a, wrapped into -π..π)
    it.yaw = it.axis === 'z' ? THREE.MathUtils.euclideanModulo(Math.PI - this.rimAngle(it) + Math.PI, Math.PI * 2) - Math.PI : 0;
    it.yaw *= THREE.MathUtils.clamp(k, 0, 1);
    if (it.axis === 'z') it.obj.rotation.set(0, it.yaw, -it.tilt); else it.obj.rotation.set(it.tilt, 0, 0);
    // position = lip - R·lipLocal, so turning never moves the lip
    this.q.setFromEuler(this.e.copy(it.obj.rotation));
    const off = it.lip.clone().applyQuaternion(this.q);
    it.obj.position.copy(lip).sub(off);
  }

  /** The vessel's lip in world space. */
  private lipOf(it: Pourable, out: THREE.Vector3) {
    it.obj.updateMatrixWorld();
    return out.copy(it.lip).applyMatrix4(it.obj.matrixWorld);
  }

  /** Which way the pour leaves the lip: along the spout's channel, or straight down for the lemon. */
  private spoutDir(it: Pourable, out: THREE.Vector3) {
    if (it.axis === 'x') return out.set(0, -1, 0);
    const a = it.tilt + SPOUT_DROOP;
    return out.set(Math.cos(a) * Math.cos(it.yaw), -Math.sin(a), -Math.cos(a) * Math.sin(it.yaw)).normalize();
  }

  // ---- lemon -----------------------------------------------------------------------------

  /**
   * Squeeze in pulses at 1.6 Hz, an ease-in-out press to 72% along its axis and back. Each
   * press, as it bites, sends 4-6 drops off the rim, a short thread that breaks into drops,
   * and now and then a pip.
   */
  private squeezeLemon(it: Pourable, dt: number) {
    const before = (this.squeezeT * SQUEEZE_HZ) % 1;
    this.squeezeT += dt;
    const ph = (this.squeezeT * SQUEEZE_HZ) % 1;
    this.squeeze = 1 - (1 - SQUEEZED) * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2));
    setSqueeze(it.obj, this.squeeze);
    if (before < 0.3 && ph >= 0.3) {
      this.squeezes++;
      this.threadLeft = THREAD;
      this.drops.drip(() => this.lipNow, 4 + Math.floor(Math.random() * 3));
      if (Math.random() < 0.3) {
        this.lipOf(it, this.w);
        this.pips.emit({ at: this.w, vel: { x: 0, y: -0.08, z: 0.02 }, life: 1, scale: 0.0028, spin: 6 });
      }
      sound.play('lemon', { gain: 0.45 + 0.15 * Math.random(), rate: 0.95 + 0.15 * Math.random() }); // the recorded squeeze, a different take each press
    }
    const wasThread = this.threadLeft > 0;
    this.threadLeft = Math.max(0, this.threadLeft - dt);
    this.stream.flow = this.threadLeft > 0 ? 1 : 0;
    // the thread snaps: what was left on the rim falls as a drop or two
    if (wasThread && this.threadLeft === 0) this.drops.drip(() => this.lipNow, 1 + Math.floor(Math.random() * 2));
  }

  /** A drop falling back in: a tiny ring, and lemon juice tints the batter where it lands. */
  private dropLanded(at: THREE.Vector3, size: number) {
    const { bowl } = this.ctx;
    bowl.ripple(at, 0.12 + 40 * size, 0.6);
    if (this.pouredItem?.kind === 'lemon') bowl.tintSpot(at, LEMON_TINT, 0.15);
    // every drop that falls back in plips (a bigger bead louder); lemon drops are quieter
    this.dripSound(THREE.MathUtils.clamp(0.08 + 30 * size, 0.08, 0.35) * (this.pouredItem?.kind === 'lemon' ? 0.6 : 1));
  }

  private dripSound(gain: number) {
    if (this.dripT < DRIP_GAP) return;
    if (this.pouredItem?.kind === 'liquid') {
      if (this.dripsLeft <= 0 || this.stream.flow > 0.05) return;
      this.dripsLeft--;
    }
    this.dripT = 0;
    sound.play('drip', { gain, rate: 0.85 + Math.random() * 0.4 });
  }

  // ---- berries ---------------------------------------------------------------------------

  /**
   * The dish arrives: give it a kinematic body (a floor and a low ring, like the glass)
   * and each of its berries a real ball body, and give the batter a kinematic floor.
   */
  private setupBerries(it: Pourable) {
    const { k, bowl } = this.ctx;
    if (this.dishBody) return;
    this.dishBody = k.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(it.obj.position.x, it.obj.position.y, it.obj.position.z));
    k.world.createCollider(RAPIER.ColliderDesc.cylinder(DISH.floorTop / 2, DISH.floorR + 0.004).setTranslation(0, DISH.floorTop / 2, 0).setFriction(0.5), this.dishBody);
    const N = 14;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      this.q.setFromAxisAngle(this.v.set(0, 1, 0), -a);
      k.world.createCollider(RAPIER.ColliderDesc.cuboid(0.0015, DISH.ringTop / 2, Math.PI * DISH.ringR / N + 0.001)
        .setTranslation(Math.cos(a) * DISH.ringR, DISH.ringTop / 2, Math.sin(a) * DISH.ringR)
        .setRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w }).setFriction(0.3), this.dishBody);
    }
    // The batter: a thin disc just under the surface, kept inside its edge, following the level.
    this.floorBody = k.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(bowl.home.x, bowl.surfaceY() - 0.003, bowl.home.z));
    this.floorCollider = k.world.createCollider(RAPIER.ColliderDesc.cylinder(0.003, Math.max(0.03, bowl.surfaceRadius() - 0.01)).setFriction(1.2).setRestitution(0.15), this.floorBody);
    for (const m of it.obj.children.filter((c) => c.name === 'berry') as THREE.Mesh[]) {
      this.berries.push({ mesh: m, body: null, state: 'kept', t: 0, speed: 0, rate: berryRate() });
    }
    this.berriesStart = this.berries.length;
    this.wakeBerries(it);
  }

  /** Kept berries become balls again (on the counter at first, then each time the dish tips). */
  private wakeBerries(it: Pourable) {
    for (const b of this.berries) if (b.state === 'kept') this.free(b);
  }

  private free(b: Berry) {
    const { k } = this.ctx;
    k.scene.attach(b.mesh);
    const p = b.mesh.position, r = b.mesh.quaternion;
    const body = k.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: r.x, y: r.y, z: r.z, w: r.w })
      .setLinearDamping(0.3).setAngularDamping(0.6).setCcdEnabled(true));
    const col = k.world.createCollider(RAPIER.ColliderDesc.ball(BERRY_R).setRestitution(0.3).setFriction(0.7).setDensity(600).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body);
    this.berryOf.set(col.handle, b);
    b.body = body;
    b.state = 'free';
    b.t = 0;
  }

  /** Is this world point inside the dish (its floor up to a little above the ring)? */
  private inDish(it: Pourable, p: THREE.Vector3) {
    const l = it.obj.worldToLocal(this.w.copy(p));
    return Math.hypot(l.x, l.z) < DISH.ringR && l.y > -0.004 && l.y < DISH.ringTop + 2 * BERRY_R + 0.004; // a heap rises above the low ring
  }

  /** Berries still in the dish stop being balls and ride along as part of it. */
  private keepBerries(it: Pourable) {
    for (const b of this.berries) {
      if (b.state !== 'free' || !b.body) continue;
      if (!this.inDish(it, b.mesh.position)) continue;
      this.dropBody(b);
      it.obj.attach(b.mesh);
      b.state = 'kept';
    }
  }

  /** While you hold: a berry or two at a time comes forward from the back of the dish. */
  private feedBerries(it: Pourable, dt: number) {
    if (this.berries.some((b) => b.state === 'kept')) this.wakeBerries(it);
    this.feedT += dt;
    if (this.feedT < FEED_EVERY) return;
    this.feedT = 0;
    if (this.berries.length >= MAX_BERRIES) return;
    let loose = 0;
    for (const b of this.berries) if (b.state === 'free' && this.inDish(it, b.mesh.position)) loose++;
    const n = Math.min(IN_DISH - loose, 1 + Math.round(Math.random()));
    for (let i = 0; i < n; i++) {
      const m = makeBerry();
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      // from the high back of the dish, so it rolls down across the floor and out over the lip
      m.position.set(-0.012 + (Math.random() - 0.5) * 0.006, DISH.floorTop + BERRY_R + 0.002 + i * 0.017, (Math.random() - 0.5) * 0.02);
      it.obj.add(m);
      const b: Berry = { mesh: m, body: null, state: 'kept', t: 0, speed: 0, rate: berryRate() };
      this.berries.push(b);
      this.free(b);
    }
  }

  /** The dish's body follows the dish, the batter's floor follows the level, meshes follow bodies. */
  private updateBerries(dt: number) {
    const { bowl } = this.ctx;
    const dish = this.items.find((x) => x.kind === 'berries');
    if (!dish || !this.floorBody) return;
    if (this.dishBody) {
      const p = dish.obj.position, r = dish.obj.quaternion;
      this.dishBody.setNextKinematicTranslation({ x: p.x, y: p.y, z: p.z });
      this.dishBody.setNextKinematicRotation({ x: r.x, y: r.y, z: r.z, w: r.w });
    }
    const sy = bowl.surfaceY();
    this.floorBody.setNextKinematicTranslation({ x: bowl.home.x, y: sy - 0.003, z: bowl.home.z });
    const lim = bowl.radiusAt(bowl.level);
    let air = 0;
    for (const b of this.berries) {
      if (!b.body) continue;
      const t = b.body.translation(), r = b.body.rotation(), lv = b.body.linvel();
      b.mesh.position.set(t.x, t.y, t.z);
      b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      b.speed = Math.hypot(lv.x, lv.y, lv.z);
      const d = Math.hypot(t.x - bowl.home.x, t.z - bowl.home.z);
      if (b.state === 'free') {
        if (d < lim && t.y < sy + 0.002) this.landed(b); // slipped past the floor's edge: still in the batter
        else if (t.y < bowl.home.y + bowl.floorY - 0.01 || (d > bowl.rimRadius && t.y < bowl.home.y + bowl.rimY && !this.inDish(dish, b.mesh.position))) {
          // Never happens in play; if a berry ever got away it goes into the batter, not onto the counter.
          this.berriesLost++;
          this.embed(b);
          continue;
        } else if (!this.inDish(dish, b.mesh.position) && t.y > sy + BERRY_R * 1.5) air++;
        // after the item, anything still loose goes in
        if (this.finished && this.releasedFor > 0.55 && !this.inDish(dish, b.mesh.position)) this.embed(b);
      } else if (b.state === 'landed') {
        b.t += dt;
        if (b.t > SINK_AFTER || (b.t > 0.08 && b.speed < 0.04)) this.embed(b);
      }
    }
    this.berriesAirMax = Math.max(this.berriesAirMax, air);
    this.dbg.berriesAir = air;
  }

  private landed(b: Berry) {
    if (b.state !== 'free' || !b.body) return;
    const { bowl } = this.ctx;
    b.state = 'landed';
    b.t = 0;
    const at = b.mesh.position;
    const s = THREE.MathUtils.clamp(b.speed, 0, 1.5);
    bowl.ripple(at, 0.25 + 0.6 * s, 0.9);
    bowl.dimple(at, 0.0015 + 0.002 * s);
    if (this.plipT >= PLIP_GAP) { this.plipT = 0; sound.play('berry', { gain: THREE.MathUtils.clamp(0.1 + 0.5 * s, 0.1, 0.8), rate: b.rate }); }
  }

  /** Settle a berry into the batter: no body, a mesh in the bowl's contents just under the surface. */
  private embed(b: Berry) {
    const { bowl } = this.ctx;
    this.dropBody(b);
    const p = bowl.group.worldToLocal(this.w.copy(b.mesh.position));
    // inside the batter's edge, and not inside another berry
    const maxR = bowl.radiusAt(bowl.level) - BERRY_R * 1.4;
    for (let pass = 0; pass < 3; pass++) {
      for (const o of this.berries) {
        if (o === b || o.state !== 'embedded') continue;
        const dx = p.x - o.mesh.position.x, dz = p.z - o.mesh.position.z;
        const dd = Math.hypot(dx, dz);
        if (dd < BERRY_R * 1.8) {
          const push = (BERRY_R * 1.8 - dd) / Math.max(dd, 1e-4);
          if (dd < 1e-4) p.x += BERRY_R; else { p.x += dx * push; p.z += dz * push; }
        }
      }
      const r = Math.hypot(p.x, p.z);
      if (r > maxR) { p.x *= maxR / r; p.z *= maxR / r; }
    }
    p.y = bowl.floorY + bowl.level - BERRY_SINK;
    bowl.contents.add(b.mesh);
    b.mesh.position.copy(p);
    b.state = 'embedded';
  }

  private dropBody(b: Berry) {
    if (!b.body) return;
    for (let i = 0; i < b.body.numColliders(); i++) this.berryOf.delete(b.body.collider(i).handle);
    this.ctx.k.world.removeRigidBody(b.body);
    b.body = null;
  }

  /** The berries' item is done: what is left in the dish stays in it; the dish loses its body. */
  private endBerries() {
    const dish = this.items.find((x) => x.kind === 'berries');
    if (dish) this.keepBerries(dish);
    if (this.dishBody) { this.ctx.k.world.removeRigidBody(this.dishBody); this.dishBody = null; }
  }

  private onCollision(a: RAPIER.Collider, b: RAPIER.Collider) {
    if (!this.floorCollider) return;
    const other = a.handle === this.floorCollider.handle ? b : b.handle === this.floorCollider.handle ? a : null;
    if (!other) return;
    const berry = this.berryOf.get(other.handle);
    if (berry) this.landed(berry);
  }

  // ---- cream -----------------------------------------------------------------------------

  /**
   * The yolks melt into the cream: each shrinks away over 0.8 s with a ripple, tints the
   * batter where it was, and drifts out of the stream's way, so none is ever pierced.
   */
  private dissolveYolks(dt: number) {
    const { bowl } = this.ctx;
    const surfaceLocalY = bowl.floorY + bowl.level;
    const landing = bowl.group.worldToLocal(this.stream.landing.clone());
    for (const y of bowl.contents.children) {
      if (y.name !== 'yolk' || !y.visible) continue;
      const base = (y.userData.baseScale as THREE.Vector3 | undefined) ?? y.scale.clone();
      y.userData.baseScale = base;
      const melt = (y.userData.melt as number | undefined) ?? 0;
      if (melt === 0) {
        const w = y.getWorldPosition(new THREE.Vector3());
        bowl.ripple(w, 0.7);
        bowl.tintAtWorld(w, 0xfff0c8, 0.9);
      }
      const m = Math.min(1, melt + dt / 0.8);
      y.userData.melt = m;
      const s = 1 - easeInOutCubic(m);
      y.scale.set(base.x * s, base.y * s, base.z * s);
      // ride on the surface, nudged away from where the stream lands
      y.position.y = Math.max(y.position.y, surfaceLocalY - 0.002);
      const dx = y.position.x - landing.x, dz = y.position.z - landing.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.035 && d > 1e-5) { y.position.x += (dx / d) * 0.03 * dt; y.position.z += (dz / d) * 0.03 * dt; }
      if (m >= 1) y.visible = false;
    }
  }

  // ---- checks ----------------------------------------------------------------------------

  /** Numbers the test driver checks: lip on the stream, the landing under it, the timing. */
  private measure(it: Pourable, target: number) {
    const { bowl } = this.ctx;
    const lip = it.state === 'active' ? this.lipOf(it, new THREE.Vector3()) : this.lipNow;
    const s = this.stream;
    let yolks = 0;
    for (const y of bowl.contents.children) if (y.name === 'yolk' && y.visible && y.scale.x > 0.01) yolks++;
    const sy = bowl.surfaceY();
    const embedded = this.berries.filter((b) => b.state === 'embedded').map((b) => {
      const p = b.mesh.getWorldPosition(new THREE.Vector3());
      return [Math.hypot(p.x - bowl.home.x, p.z - bowl.home.z), p.y - sy];
    });
    const dish = this.items.find((x) => x.kind === 'berries');
    Object.assign(this.dbg, {
      tilt: it.tilt, tiltTarget: target, vesselPhase: it.phase, holdT: this.holdT, releasedFor: this.releasedFor === Infinity ? -1 : this.releasedFor,
      streamActive: s.active, streamVisible: s.mesh.visible, streamWidth: s.active ? 2 * s.lipRadius : 0,
      landedFraction: s.landedFraction, landingFlow: s.landingFlow,
      lipErr: s.active ? lip.distanceTo(s.from) : -1,
      lipAxis: Math.hypot(lip.x - bowl.home.x, lip.z - bowl.home.z), rimLimit: bowl.rimRadius - 0.02,
      lipLanding: s.active ? Math.hypot(s.landing.x - lip.x, s.landing.z - lip.z) : -1,
      widthRatio: s.active && s.lipRadius > 0 ? s.landRadius / s.lipRadius : -1,
      streamNearLip: Math.min(9, s.distanceTo(this.lipNow)), // 9 m = no stream
      droplets: this.drops.count, level: bowl.level, mound: bowl.moundHeight, yolks,
      flour: this.sift.count, dustRadius: bowl.dustRadius,
      squeeze: it.kind === 'lemon' ? squeezeOf(it.obj) : 1, squeezes: this.squeezes,
      embedded, embedLimit: bowl.radiusAt(bowl.level), berriesStart: this.berriesStart, berriesLost: this.berriesLost, berriesAirMax: this.berriesAirMax,
      berriesInDish: dish ? dish.obj.children.filter((c) => c.name === 'berry').length : 0,
      // how far the held vessel's lowest point is over the rim plane while it is over the bowl (null: not over it)
      vesselClear: it.state === 'active' && (it.phase === 'carry' || it.phase === 'untilt') && it.liftK > TIP_AT
        ? this.lipOf(it, new THREE.Vector3()).y + this.lowest(it) - (bowl.home.y + bowl.rimY) : null,
      vesselRot: Math.max(...this.items.filter((x) => x.obj.visible && x.state !== 'leaving').map((x) => Math.abs(x.obj.rotation.x) + Math.abs(x.obj.rotation.y) + Math.abs(x.obj.rotation.z)), 0),
    });
  }

  /** The last vessel finishes going home and sliding off before the Step is torn down. */
  leave() { return this.lastLeave; }

  dispose() {
    const { k } = this.ctx;
    k.pointer.handlers.splice(k.pointer.handlers.indexOf(this), 1);
    k.onCollision.delete(this.collisionHandler);
    // Every berry that is not in the dish ends up in the batter, and no body outlives the Step.
    for (const b of this.berries) if (b.state === 'free' || b.state === 'landed') this.embed(b);
    for (const body of [this.dishBody, this.floorBody]) if (body) k.world.removeRigidBody(body);
    this.dishBody = this.floorBody = this.floorCollider = null;
    for (const it of this.items) k.scene.remove(it.obj);
    this.stream.dispose(k.scene);
    this.drops.dispose(k.scene);
    this.sift.dispose(k.scene);
    this.pips.dispose(k.scene);
    this.loop?.stop();
  }

  targets() {
    const out: Record<string, THREE.Vector3> = { anywhere: this.ctx.bowl.home.clone().setY(this.ctx.bowl.surfaceY()) };
    if (this.item.state === 'active') out.item = this.item.obj.position.clone();
    out.pan = this.ctx.pan.position.clone(); // parked off screen; the driver checks it stays clear
    return out;
  }

  /** The finger cue goes on the vessel waiting at the front slot. */
  cue() {
    const it = this.item;
    if (it.state !== 'active' && it.state !== 'arriving') return null;
    const names: Record<string, string> = { cream: 'jug', flour: 'cup', blueberries: 'dish', lemon: 'lemon' };
    return { name: names[it.name], at: it.obj.position.clone().setY(it.obj.position.y + GRAB_UP) };
  }

  progress() { return { progress: this.meter.progress, stage: this.finished ? 'done' : this.holding ? `pouring ${this.item.name}` : this.item.name }; }

  meterInfo() { return { duration: this.meter.duration, sweet: this.meter.sweet }; }

  debug() {
    return {
      item: this.index, itemName: this.item.name, itemState: this.item.state, lift: this.item.liftK, holding: this.holding, streamFlow: this.stream.flow,
      berries: this.berries.filter((b) => b.body).length,
      visible: this.items.filter((it) => it.obj.visible).map((it) => it.name),
      ...this.dbg,
    };
  }

  focus() {
    for (const it of this.items) if (it.obj.visible && it.phase !== 'rest') return it.obj;
    return null;
  }

  boxes() {
    const names: Record<string, string> = { cream: 'jug', flour: 'cup', blueberries: 'dish', lemon: 'lemon' };
    const out: Record<string, THREE.Object3D> = {};
    for (const it of this.items) if (it.obj.visible) out[names[it.name]] = it.obj;
    return out;
  }
}

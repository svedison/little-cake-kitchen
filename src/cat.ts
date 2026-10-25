// The chef cat: a round body with a flat cartoon face that cross-fades between expressions.
// It acts, too: it points at what a Step wants touched, hops when one is done, leans in to
// watch a pour or the oven, blinks, waves hello, and eats the cake in three real bites.
// Built in code, no rig: every moving part (paws, head, ears) rides on a spring.
import * as THREE from 'three';
import { P, SLOT } from './kitchen';
import type { Kitchen } from './kitchen';
import type { Hud } from './hud';
import { STATION_X } from './camera';
import { Spring, Spring3, easeInOutCubic, easeOutCubic } from './motion';
import { sound } from './sound';

export type Expr = 'idle' | 'excited' | 'ooh' | 'sleepy' | 'yum' | 'meh' | 'love' | 'mad' | 'furious';
/** What the cat is doing right now (most important first when two overlap), for the flow and the test driver. */
export type CatAction = 'chomp' | 'cheer' | 'hop' | 'travel' | 'wave' | 'point' | 'lean' | 'idle';
/** The mouth while it eats: wide open for the cake, shut on a bite. */
type Mouth = 'normal' | 'open' | 'shut';

const FUR = 0xffe3c2;
/** The fur flushes this red while the cat is on strike. */
const FUR_HOT = 0xff9c8a;
const EAR = 0xffb6c1;

/** A move between Stations: three hops along the counter in 0.8 s, each 3.5 cm high (tuned by eye). */
const TRAVEL = { time: 0.8, count: 3, height: 0.035 };
/** A hop on the spot (a Step done): crouch, a 2 cm jump, land and squash; 0.35 s in all. */
const HOP = { time: 0.35, crouch: 0.08, land: 0.27, height: 0.02 };
/** The cheer: two hops back to back with the ears going. */
const CHEER_T = HOP.time * 2;
/**
 * On a portrait phone the Stove view is no wider than the oven, so the cat sits on top of it
 * instead (a warm oven is a cat's favourite spot), at the back left beside the dial. Tuned
 * by eye against both Stove poses (bake.ts FOCUS): standing back it sits left of the dial,
 * and leaned in to the window it is still whole on screen, 40 px clear of every edge.
 */
const ON_OVEN = new THREE.Vector3(STATION_X.stove - 0.05, 0.21, -0.32);
/** The most the body turns toward what it points at (rad), and the head on top of that. */
const YAW_MAX = 0.5;
const HEAD_YAW_MAX = 0.35;
const HEAD_PITCH_MAX = 0.35;
/** Expression cross-fade (s) and the little swell of the head that goes with it. */
const FADE_T = 0.12;
const BUMP = { time: 0.2, scale: 0.08 };
/** Blinks: one every 3-5 s, eyes shut for 0.1 s. */
const BLINK = { min: 3, max: 5, shut: 0.1 };
const WAVE_T = 1;
/**
 * The chomp (s from the cake reaching the mouth): the head leans 1.5 cm toward the cake, the
 * jaws come down on it three times, then a gulp. Bite times are a quarter second apart, the
 * rhythm of a real three-bite chomp.
 */
export const CHOMP = { bites: [0.224, 0.449, 0.673], lean: 0.015, shut: 0.08, end: 1.05 };

/** Where the paws sit at rest, in the cat's own (unscaled) frame. */
const PAW_REST = (s: number) => new THREE.Vector3(s * 0.035, 0.016, 0.04);
const HEAD_Y = 0.125;
const EYES_OPEN: Expr[] = ['idle', 'excited', 'ooh', 'mad'];
const UP = new THREE.Vector3(0, 1, 0);

interface FaceLayer { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture }

export class Cat {
  readonly group = new THREE.Group();
  /** Everything that hops (inside the seat's position and turn); a Nudge wiggles it. */
  readonly rig = new THREE.Group();
  expr: Expr = 'idle';
  /** On strike (hit too often): it stays furious, says nothing but its own lines, and points at nothing. */
  sulking = false;
  private heat = 0;
  private fur!: THREE.MeshStandardMaterial;
  private readonly head = new THREE.Group();
  private readonly paws: THREE.Mesh[] = [];
  private readonly ears: THREE.Mesh[] = [];
  // Tuned by eye: a paw is quick and a touch bouncy; the head is heavier and settles softly.
  private readonly pawSpring = [new Spring3(PAW_REST(-1), 260, 0.55), new Spring3(PAW_REST(1), 260, 0.55)];
  private readonly headYaw = new Spring(0, 120, 0.8);
  private readonly headPitch = new Spring(0, 120, 0.8);
  private readonly headTilt = new Spring(0, 140, 0.6);
  private readonly headPos = new Spring3(new THREE.Vector3(0, HEAD_Y, 0), 180, 0.75);
  private readonly bodyYaw = new Spring(0, 90, 0.85);
  // faces: two layers to cross-fade between, and the shut-eyes frame a blink shows
  private readonly layers: FaceLayer[] = [];
  private readonly blinkLayer: FaceLayer;
  private cur = 0;
  private fadeT = Infinity;
  private bumpT = Infinity;
  private blinkIn = 3;
  private blinkT = Infinity;
  private mouth_: Mouth = 'normal';
  /** The cat is built at "big" size and scaled down so it sits behind the bowl. */
  private readonly base = 0.68;
  private trip: { from: THREE.Vector3; to: THREE.Vector3; t: number; dir: number; yaw0: number } | null = null;
  private yaw = 0;
  private restYaw = 0;
  private squashY = 1;
  private bounceT = 99;
  private hopT = Infinity;
  private cheerT = Infinity;
  private earT = Infinity;
  private airborne = false;
  private waveT = Infinity;
  private pointing: THREE.Vector3 | null = null;
  private readonly leanAt = new THREE.Vector3();
  private leanWant = 0;
  private leanAmt = 0;
  private chompT = Infinity;
  private readonly chompFrom = new THREE.Vector3();
  private onBite: ((i: number) => void) | null = null;
  private bites = 0;
  private gulpT = Infinity;
  private readonly v = new THREE.Vector3();
  private readonly w = new THREE.Vector3();

  constructor(private readonly k: Kitchen, private readonly hud: Hud, at: THREE.Vector3) {
    this.group.position.copy(at);
    this.group.add(this.rig);
    const fur = new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.8 });
    this.fur = fur;

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.058, 32, 24), fur);
    body.position.y = 0.055;
    body.scale.set(1, 0.95, 0.9);
    this.rig.add(body);

    for (const s of [-1, 1]) {
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), fur);
      paw.position.copy(PAW_REST(s));
      this.rig.add(paw);
      this.paws.push(paw);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 10, 20, Math.PI * 0.9), fur);
    tail.position.set(0.05, 0.025, -0.03);
    tail.rotation.set(0.4, 0.6, 0);
    this.rig.add(tail);

    this.head.position.y = HEAD_Y;
    this.rig.add(this.head);
    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 24), fur);
    headMesh.scale.set(1.08, 0.92, 0.95);
    this.head.add(headMesh);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.03, 16), fur);
      ear.position.set(s * 0.035, 0.045, -0.005);
      ear.rotation.z = -s * 0.5;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.018, 16), new THREE.MeshStandardMaterial({ color: EAR }));
      inner.position.set(0, -0.003, 0.004);
      ear.add(inner);
      this.head.add(ear);
      this.ears.push(ear);
    }
    // Chef hat.
    const hat = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.016, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }));
    puff.position.y = 0.03;
    puff.scale.set(1, 0.8, 1);
    const ribbon = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.037, 0.005, 32), new THREE.MeshStandardMaterial({ color: P.pink }));
    ribbon.position.y = -0.004;
    hat.add(band, puff, ribbon);
    hat.position.set(0.012, 0.052, -0.01);
    hat.rotation.z = -0.25;
    this.head.add(hat);

    // The face: canvas textures wrapped onto patches of sphere that hug the front of the
    // head, a hair apart so they never fight; drawn in order over the head.
    const patch = new THREE.SphereGeometry(1, 32, 24, Math.PI / 2 - 0.8, 1.6, 0.55, 1.5);
    const layer = (r: number, order: number): FaceLayer => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new THREE.Mesh(patch, mat);
      mesh.scale.setScalar(r);
      mesh.position.set(0, -0.004, 0);
      mesh.rotation.x = -0.25;
      mesh.renderOrder = order;
      this.head.add(mesh);
      return { mesh, mat, canvas, tex };
    };
    this.layers.push(layer(0.0535, 1), layer(0.0537, 2));
    this.blinkLayer = layer(0.0539, 3);

    this.group.traverse((c) => { if ((c as THREE.Mesh).isMesh && !this.isFace(c)) c.castShadow = true; });
    k.scene.add(this.group);
    this.draw(this.layers[0], 'idle', 'normal');
    this.draw(this.blinkLayer, 'idle', 'normal', true);
    this.layers[0].mat.opacity = 1;
    this.blinkIn = this.nextBlink();
    k.updaters.add((dt, t) => this.update(dt, t));
  }

  private isFace(o: THREE.Object3D) { return this.layers.some((l) => l.mesh === o) || this.blinkLayer?.mesh === o; }

  /** World point at the side of the head, where the speech bubble points. */
  headSide() { return this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.03, 0.01, 0)); }

  /** World point just over the top of the chef hat, where a bubble above the cat points. */
  hatTop() { return this.head.localToWorld(new THREE.Vector3(0.012, 0.125, -0.01)); }

  /** World point at the middle of the face. */
  faceCentre() { return this.head.getWorldPosition(new THREE.Vector3()); }

  /** World point the cake goes into: the mouth, wherever the head is turned. */
  mouth() { return this.head.localToWorld(new THREE.Vector3(0, -0.022, 0.044)); }

  /** World position of a paw (s = -1 left, 1 right as you look at the cat). */
  paw(s: -1 | 1) { return this.paws[s < 0 ? 0 : 1].getWorldPosition(new THREE.Vector3()); }

  // ---- the face -------------------------------------------------------------------------

  /** Change expression: the new face cross-fades in over 0.12 s and the head swells a touch. */
  express(expr: Expr, force = false) {
    if (this.sulking && !force) return;
    if (expr === this.expr && this.mouth_ === 'normal') return;
    this.expr = expr;
    this.mouth_ = 'normal';
    this.finishFade();
    const next = 1 - this.cur;
    this.draw(this.layers[next], expr, 'normal');
    this.draw(this.blinkLayer, expr, 'normal', true);
    this.fadeT = 0;
    this.bumpT = 0;
  }

  /** Swap the mouth on the face showing now (no fade: a bite is quicker than that). */
  private setMouth(m: Mouth) {
    if (m === this.mouth_) return;
    this.mouth_ = m;
    this.finishFade();
    this.draw(this.layers[this.cur], this.expr, m);
  }

  private finishFade() {
    if (this.fadeT === Infinity) return;
    this.fadeT = Infinity;
    this.cur = 1 - this.cur;
    this.layers[this.cur].mat.opacity = 1;
    this.layers[1 - this.cur].mat.opacity = 0;
  }

  private nextBlink() { return BLINK.min + Math.random() * (BLINK.max - BLINK.min); }

  /** Shut the eyes for 0.1 s (it happens on its own every 3-5 s). */
  blink() {
    if (!EYES_OPEN.includes(this.expr) || this.mouth_ !== 'normal') return;
    this.blinkT = 0;
  }

  private draw(l: FaceLayer, expr: Expr, mouth: Mouth, shut = false) {
    const c = l.canvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 256);
    c.lineCap = 'round';
    c.lineWidth = 9;
    c.strokeStyle = '#6b4a3a';
    // Blush.
    c.fillStyle = 'rgba(255,140,165,0.55)';
    for (const x of [62, 194]) { c.beginPath(); c.ellipse(x, 150, 22, 13, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#6b4a3a';
    const eyes = (fn: (x: number) => void) => { fn(92); fn(164); };
    if (shut) {
      // a blink: soft closed lids, the shape of a happy squint turned down
      eyes((x) => { c.beginPath(); c.arc(x, 104, 13, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke(); });
    } else switch (expr) {
      case 'idle':
        eyes((x) => { c.beginPath(); c.ellipse(x, 110, 11, 14, 0, 0, Math.PI * 2); c.fill(); });
        break;
      case 'excited':
        eyes((x) => { c.beginPath(); c.ellipse(x, 108, 15, 18, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x + 5, 101, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#6b4a3a'; });
        break;
      case 'ooh':
        eyes((x) => { c.beginPath(); c.arc(x, 110, 15, 0, Math.PI * 2); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x - 4, 104, 5, 0, Math.PI * 2); c.fill(); c.fillStyle = '#6b4a3a'; });
        break;
      case 'sleepy':
        eyes((x) => { c.beginPath(); c.arc(x, 108, 14, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); });
        break;
      case 'yum':
        eyes((x) => { c.beginPath(); c.arc(x, 116, 14, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke(); });
        break;
      case 'meh':
        eyes((x) => { c.beginPath(); c.moveTo(x - 13, 110); c.lineTo(x + 13, 110); c.stroke(); });
        break;
      case 'mad':
      case 'furious': {
        // brows slanting down to the nose; furious squeezes the eyes to slits
        const hot = expr === 'furious';
        c.lineWidth = hot ? 11 : 9;
        for (const [x, s] of [[92, 1], [164, -1]] as const) {
          c.beginPath(); c.moveTo(x - s * 20, hot ? 78 : 82); c.lineTo(x + s * 14, hot ? 96 : 94); c.stroke();
        }
        c.lineWidth = 9;
        if (hot) eyes((x) => { c.beginPath(); c.moveTo(x - 13, 112); c.lineTo(x + 13, 108); c.stroke(); });
        else eyes((x) => { c.beginPath(); c.ellipse(x, 113, 10, 9, 0, 0, Math.PI * 2); c.fill(); });
        break;
      }
      case 'love':
        c.fillStyle = '#ff6b8a';
        eyes((x) => {
          c.beginPath();
          c.moveTo(x, 124);
          c.bezierCurveTo(x - 24, 104, x - 10, 86, x, 100);
          c.bezierCurveTo(x + 10, 86, x + 24, 104, x, 124);
          c.fill();
        });
        c.fillStyle = '#6b4a3a';
        break;
    }
    // Nose and mouth.
    c.fillStyle = '#ff8fa3';
    c.beginPath(); c.moveTo(118, 138); c.lineTo(138, 138); c.lineTo(128, 150); c.closePath(); c.fill();
    c.strokeStyle = '#6b4a3a';
    c.lineWidth = 7;
    if (mouth === 'open') {
      // wide open for the cake: a dark mouth with a pink tongue
      c.fillStyle = '#6b3a32';
      c.beginPath(); c.ellipse(128, 176, 24, 22, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#ff8fa3';
      c.beginPath(); c.ellipse(128, 188, 14, 8, 0, 0, Math.PI * 2); c.fill();
      l.tex.needsUpdate = true;
      return;
    }
    c.beginPath();
    if (mouth === 'shut') { c.moveTo(108, 166); c.quadraticCurveTo(118, 178, 128, 168); c.quadraticCurveTo(138, 178, 148, 166); }
    else if (expr === 'meh') { c.moveTo(108, 172); c.lineTo(148, 172); }
    else if (expr === 'excited' || expr === 'love' || expr === 'yum') { c.arc(128, 160, 20, 0.15 * Math.PI, 0.85 * Math.PI); }
    else if (expr === 'ooh') { c.ellipse(128, 172, 9, 12, 0, 0, Math.PI * 2); }
    else if (expr === 'mad' || expr === 'furious') { c.arc(128, 186, 18, 1.15 * Math.PI, 1.85 * Math.PI); }
    else { c.moveTo(112, 162); c.quadraticCurveTo(120, 174, 128, 164); c.quadraticCurveTo(136, 174, 144, 162); }
    c.stroke();
    if (expr === 'yum' && mouth === 'normal') { c.fillStyle = '#ff8fa3'; c.beginPath(); c.ellipse(128, 178, 9, 7, 0, 0, Math.PI); c.fill(); }
    l.tex.needsUpdate = true;
  }

  say(line: string, expr?: Expr, force = false) {
    if (this.sulking && !force) return;
    if (expr) this.express(expr, force);
    this.hud.bubble(line);
    // A hop or a cheer is already the bounce; both at once lift the hat into the phone's header.
    if (this.hopT >= HOP.time && this.cheerT >= CHEER_T) this.bounceT = 0;
  }

  // ---- the acts ---------------------------------------------------------------------------

  /**
   * Point at a thing: the paw on its side lifts and reaches toward it, the body turns its
   * way (at most 0.5 rad) and the head tilts. It holds until release() (the first grab or
   * hold of the Step); calling it again moves the aim.
   */
  point(worldPos: THREE.Vector3) {
    if (this.sulking) return;
    if (this.pointing) this.pointing.copy(worldPos);
    else this.pointing = worldPos.clone();
  }

  /** Stop pointing (the player has it). */
  release() { this.pointing = null; }

  get isPointing() { return !!this.pointing; }

  /** A hop on the spot: crouch, a 2 cm jump, land with a squash (0.35 s). Every Step done gets one. */
  hop() {
    if (this.chompT < CHOMP.end) return;
    this.hopT = 0;
  }

  /** Two hops, the ears going, hearts for eyes: the reveal and a bussin cake. */
  cheer() {
    this.cheerT = 0;
    this.earT = 0;
    this.express('love');
  }

  /** A hello: a paw comes up and waves for a second. */
  wave() { this.waveT = 0; }

  /** A Nudge on the cat: the ears flick (the wiggle itself is on the rig, see gestures.nudge). */
  flick() { this.earT = Math.min(this.earT, CHEER_T - 0.35); }

  /**
   * Watch something closely while a Hold or Stir runs (the pour, the whisk, the oven): the
   * head turns toward it and leans in by `amount` (0..1). Call it every frame it applies; it
   * eases back on its own once the calls stop.
   */
  leanTo(worldPos: THREE.Vector3, amount: number) {
    this.leanAt.copy(worldPos);
    this.leanWant = Math.max(this.leanWant, THREE.MathUtils.clamp(amount, 0, 1));
  }

  /**
   * The taste test. The head leans 1.5 cm toward the cake (held up at `toward`), the mouth opens,
   * and the jaws come down three times (CHOMP.bites); onBite(i) is called on each, so the
   * cake can go in bites. Game calls gulp() once it is down to a crumb.
   */
  chomp(toward: THREE.Vector3, onBite: (i: number) => void) {
    this.pointing = null;
    this.chompT = 0;
    this.bites = 0;
    this.gulpT = Infinity;
    this.chompFrom.copy(toward);
    this.onBite = onBite;
    this.hopT = this.cheerT = Infinity;
    if (this.expr !== 'yum') this.express('yum');
    this.setMouth('open');
  }

  /** The last of the cake goes down: the head tips back, the body squashes once. */
  gulp() {
    if (this.gulpT !== Infinity) return;
    this.gulpT = 0;
    this.setMouth('shut');
  }

  /** How long into the chomp (s), Infinity when not eating. */
  get chompTime() { return this.chompT < CHOMP.end ? this.chompT : Infinity; }

  /** How far the head is out of its seat toward what it watches or eats (m, world), for the test driver. */
  get headLean() {
    const p = this.headPos.value;
    return Math.hypot(p.x, p.y - HEAD_Y, p.z) * this.group.scale.y;
  }

  get action(): CatAction {
    if (this.chompT < CHOMP.end) return 'chomp';
    if (this.cheerT < CHEER_T) return 'cheer';
    if (this.hopT < HOP.time) return 'hop';
    if (this.trip) return 'travel';
    if (this.waveT < WAVE_T) return 'wave';
    if (this.pointing) return 'point';
    if (this.leanAmt > 0.05) return 'lean';
    return 'idle';
  }

  /**
   * Follow the recipe to a Station: hop along the counter to its spot beside the bowl or
   * beside the oven. Other Stations (the Fridge) keep the cat where it is.
   */
  goTo(stationX: number) {
    const stove = Math.abs(stationX - STATION_X.stove) < 1e-3;
    const counter = Math.abs(stationX - STATION_X.counter) < 1e-3;
    if (!stove && !counter) return;
    // On top of the warm oven on every screen: beside it, a wide view's lean-in hides it behind the oven's side.
    const to = (stove ? ON_OVEN : SLOT.cat).clone();
    this.restYaw = stove ? 0.15 : 0;
    const from = this.group.position.clone();
    if (from.distanceTo(to) < 1e-3) return;
    this.pointing = null;
    this.trip = { from, to, t: 0, dir: Math.sign(to.x - from.x) || 1, yaw0: this.yaw };
  }

  /** Is the cat mid-hop between Stations (for the test driver). */
  get hopping() { return !!this.trip; }

  // ---- per frame ----------------------------------------------------------------------------

  private tripFrame(dt: number) {
    const h = this.trip!;
    const before = Math.floor((h.t / TRAVEL.time) * TRAVEL.count);
    h.t = Math.min(TRAVEL.time, h.t + dt);
    const u = h.t / TRAVEL.time;
    // Each hop eases along its third of the way and arcs up; the cat squashes as it lands.
    const n = TRAVEL.count;
    const i = Math.min(n - 1, Math.floor(u * n));
    const f = u * n - i;
    const along = (i + easeInOutCubic(f)) / n;
    this.group.position.lerpVectors(h.from, h.to, along);
    // Up onto the oven on the last hop, down off it on the first; the others stay on the counter.
    const dy = h.to.y - h.from.y;
    const climb = dy > 0 ? (i === n - 1 ? easeInOutCubic(f) : 0) : (i === 0 ? easeInOutCubic(f) : 1);
    const big = (dy > 0 && i === n - 1) || (dy < 0 && i === 0);
    this.group.position.y = h.from.y + dy * climb + Math.sin(f * Math.PI) * (TRAVEL.height + (big ? 0.06 : 0));
    this.squashY = f > 0.85 || f < 0.1 ? 0.88 : 1 + 0.06 * Math.sin(f * Math.PI);
    // Turned side-on while it travels, then back round to face the room.
    const turn = Math.min(1, u / 0.12, (1 - u) / 0.18);
    this.yaw = h.dir * 1.1 * turn + (h.yaw0 + (this.restYaw - h.yaw0) * u) * (1 - turn);
    const after = Math.floor(u * n);
    if (after > before && after <= n) sound.play('pat', { gain: 0.5 }); // a paw landing, soft
    if (h.t >= TRAVEL.time) {
      this.group.position.copy(h.to);
      this.trip = null;
      this.squashY = 1;
      this.yaw = this.restYaw;
    }
  }

  /** One hop on the spot at time t into it: [height (m), squash]. */
  private hopAt(t: number): [number, number] {
    if (t >= HOP.time) return [0, 1];
    if (t < HOP.crouch) return [0, 1 - 0.12 * Math.sin((t / HOP.crouch) * Math.PI * 0.5)]; // the crouch before the jump
    if (t < HOP.land) {
      const u = (t - HOP.crouch) / (HOP.land - HOP.crouch);
      return [HOP.height * Math.sin(u * Math.PI), 1 + 0.07 * Math.sin(u * Math.PI)]; // stretched in the air
    }
    const u = (t - HOP.land) / (HOP.time - HOP.land);
    return [0, 1 - 0.12 * Math.sin(u * Math.PI)]; // and squashed as it lands
  }

  /** Go on strike (or come off it): the fur flushes red and the face stays furious until it is over. */
  sulk(on: boolean) {
    if (on === this.sulking) return;
    if (on) { this.express('furious'); this.pointing = null; }
    this.sulking = on;
    if (!on) this.express('love');
  }

  /** Hit: the ears flick and it bounces (the Game wiggles the rig too). */
  flinch() {
    this.earT = Math.min(this.earT, CHEER_T - 0.35);
    this.bounceT = 0;
  }

  private update(dt: number, t: number) {
    const heatWant = this.sulking ? 1 : 0;
    if (Math.abs(heatWant - this.heat) > 1e-3) {
      this.heat += (heatWant - this.heat) * (1 - Math.exp(-3 * dt));
      this.fur.color.setHex(FUR).lerp(new THREE.Color(FUR_HOT), this.heat);
    }
    const inv = 1 / this.base;
    // ---- where the cat is, how it hops
    let hopY = 0, hopSq = 1;
    if (this.trip) this.tripFrame(dt);
    this.hopT += dt;
    this.cheerT += dt;
    if (this.cheerT < CHEER_T) [hopY, hopSq] = this.hopAt(this.cheerT % HOP.time);
    else if (this.hopT < HOP.time) [hopY, hopSq] = this.hopAt(this.hopT);
    if (this.airborne && hopY === 0) sound.play('pat', { gain: 0.4 }); // a soft paw-pat as it lands
    this.airborne = hopY > 0;
    this.rig.position.y = hopY * inv;

    // ---- what it looks at: the thing it points at, the thing it watches, or the cake
    this.chompT += dt;
    this.gulpT += dt;
    const chomping = this.chompT < CHOMP.end;
    this.leanAmt += (this.leanWant - this.leanAmt) * (1 - Math.exp(-6 * dt));
    this.leanWant = 0;
    const look = chomping ? this.chompFrom : this.pointing ?? (this.leanAmt > 0.02 ? this.leanAt : null);
    let wantYaw = 0, headYaw = 0, headPitch = 0, tilt = 0;
    let side: -1 | 1 = 1;
    if (look && !this.trip) {
      const seat = this.group.position;
      const dx = look.x - seat.x, dz = look.z - seat.z;
      const worldYaw = Math.atan2(dx, dz); // 0 is straight out of the face (+z)
      const off = THREE.MathUtils.clamp(worldYaw - this.restYaw, -Math.PI, Math.PI);
      const weight = chomping || this.pointing ? 1 : this.leanAmt;
      wantYaw = THREE.MathUtils.clamp(off, -YAW_MAX, YAW_MAX) * weight;
      headYaw = THREE.MathUtils.clamp(off - wantYaw, -HEAD_YAW_MAX, HEAD_YAW_MAX) * weight;
      const headY = seat.y + HEAD_Y * this.base;
      headPitch = THREE.MathUtils.clamp(Math.atan2(headY - look.y, Math.hypot(dx, dz)) * 0.6, -HEAD_PITCH_MAX, HEAD_PITCH_MAX) * weight;
      side = off >= 0 ? 1 : -1;
      if (this.pointing) tilt = -side * 0.16; // a curious head tilt toward it
    }
    if (!this.trip) this.yaw += (this.restYaw + this.bodyYaw.set(wantYaw).step(dt) - this.yaw) * (1 - Math.exp(-10 * dt));
    this.group.rotation.y = Math.sin(t * 0.7) * 0.08 * (look ? 0.3 : 1) + this.yaw;

    // ---- the head: its springs, a lean toward what it watches, the chomp's bobs, the gulp
    const hp = this.v.set(0, HEAD_Y + Math.sin(t * 2.2) * 0.003, 0);
    let pitchExtra = 0;
    if (chomping) {
      const inK = easeOutCubic(Math.min(1, this.chompT / 0.15));
      hp.z += CHOMP.lean * inv * inK;
      hp.y -= 0.004 * inv * inK;
      // each bite: the head dips onto the cake and comes back up
      for (const b of CHOMP.bites) {
        const u = (this.chompT - b + 0.05) / 0.12;
        if (u > 0 && u < 1) { hp.y -= 0.004 * inv * Math.sin(u * Math.PI); pitchExtra += 0.12 * Math.sin(u * Math.PI); }
      }
      while (this.bites < CHOMP.bites.length && this.chompT >= CHOMP.bites[this.bites]) {
        const i = this.bites++;
        this.setMouth('shut');
        this.onBite?.(i);
      }
      // jaws open again for the next bite; after the last one it chews with the mouth shut
      const lastBite = this.bites > 0 ? CHOMP.bites[this.bites - 1] : -1;
      if (this.bites < CHOMP.bites.length && this.bites > 0 && this.chompT - lastBite > CHOMP.shut) this.setMouth('open');
      if (this.gulpT < 0.3) { const g = Math.sin((this.gulpT / 0.3) * Math.PI); hp.y += 0.004 * inv * g; pitchExtra -= 0.25 * g; }
    } else if (this.leanAmt > 0.01 && !this.pointing) {
      hp.z += 0.01 * inv * this.leanAmt; // leaning in to watch
      hp.y -= 0.003 * inv * this.leanAmt;
    }
    if (!chomping && this.mouth_ !== 'normal') { this.mouth_ = 'normal'; this.draw(this.layers[this.cur], this.expr, 'normal'); }
    this.headPos.set(hp).step(dt);
    this.head.position.copy(this.headPos.value);
    this.headYaw.set(headYaw).step(dt);
    this.headPitch.set(headPitch + pitchExtra).step(dt);
    this.headTilt.set(tilt + Math.sin(t * 1.3) * 0.05).step(dt);
    this.head.rotation.set(this.headPitch.value, this.headYaw.value, this.headTilt.value);

    // ---- paws: pointing, waving, or resting
    this.waveT += dt;
    for (const s of [-1, 1] as const) {
      const i = s < 0 ? 0 : 1;
      // a paw at rest stays planted on the counter while the body twists toward something
      const want = this.w.copy(PAW_REST(s)).applyAxisAngle(UP, -this.bodyYaw.value);
      if (this.waveT < WAVE_T && s === 1) {
        // a hello: up beside the face, waving side to side
        const k = Math.min(1, this.waveT / 0.15, (WAVE_T - this.waveT) / 0.2);
        want.set(0.06, 0.1, 0.05).lerp(PAW_REST(s), 1 - k);
        want.x += 0.014 * Math.sin(this.waveT * 16) * k;
      } else if (this.pointing && s === -side && !this.trip) {
        // The far paw comes up in front of the chest as the body turns toward the thing,
        // bobbing as if to say "that one!" (the near paw would reach into the bowl beside it).
        want.set(s * 0.025, 0.088 + 0.006 * Math.sin(t * 6), 0.068);
      }
      this.pawSpring[i].set(want).step(dt);
      this.paws[i].position.copy(this.pawSpring[i].value);
    }

    // ---- ears: a wiggle while it cheers (or is poked)
    this.earT += dt;
    const ew = this.earT < CHEER_T ? Math.sin(this.earT * 30) * 0.25 * (1 - this.earT / CHEER_T) : 0;
    this.ears[0].rotation.z = 0.5 + ew;
    this.ears[1].rotation.z = -0.5 - ew;

    // ---- the face: cross-fade, blink, the swell that goes with a change
    if (this.fadeT !== Infinity) {
      this.fadeT += dt;
      const k = Math.min(1, this.fadeT / FADE_T);
      this.layers[1 - this.cur].mat.opacity = k;
      this.layers[this.cur].mat.opacity = 1 - k;
      if (k >= 1) this.finishFade();
    }
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) { this.blinkIn = this.nextBlink(); this.blink(); }
    this.blinkT += dt;
    const shut = this.blinkT < BLINK.shut && this.fadeT === Infinity && !chomping;
    this.blinkLayer.mat.opacity = shut ? 1 : 0;
    if (shut) this.layers[this.cur].mat.opacity = 0;
    else if (this.fadeT === Infinity) this.layers[this.cur].mat.opacity = 1;
    this.bumpT += dt;
    const bump = this.bumpT < BUMP.time ? 1 + BUMP.scale * Math.sin((this.bumpT / BUMP.time) * Math.PI) : 1;
    this.head.scale.setScalar(bump);

    // ---- the body: the bounce of a line, the squash of a hop or a gulp
    this.bounceT += dt;
    let s = 1;
    if (this.bounceT < 0.4) s += Math.sin((this.bounceT / 0.4) * Math.PI) * 0.12;
    let sq = this.squashY * hopSq;
    if (this.gulpT < 0.3) sq *= 1 - 0.08 * Math.sin((this.gulpT / 0.3) * Math.PI);
    this.group.scale.set(s * this.base * (1 + (1 - sq) * 0.5), s * this.base * sq, s * this.base * (1 + (1 - sq) * 0.5));

    const p = this.k.toScreen(this.headSide());
    const offscreen = p.x < -40 || p.x > window.innerWidth + 40 || p.y < -40 || p.y > window.innerHeight + 40;
    this.hud.bubbleAt(p.x, p.y, offscreen, this.k.toScreen(this.hatTop()));
  }
}

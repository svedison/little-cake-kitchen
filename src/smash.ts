// The secret: whatever the finger is carrying (the parchment, an egg, the pan, the cake) is
// also a hammer. Swing it hard into the scenery and the scenery takes damage the way a
// structure does in Fortnite: it shakes and flashes, a damage number pops off it, a health bar
// shows over it, a blue weak point appears that hits for double, and at zero it bursts into
// chunks that bounce and pop away. A while later it builds itself back up out of blue.
//
// Nothing tells the player this exists. Only the scenery breaks (backsplash tiles, the hob,
// its pots, the crock and the plant); the bowl, the oven, the cat, the book and the Shelf
// never do, so a recipe can always be finished.
import * as THREE from 'three';
import type { Kitchen } from './kitchen';
import { sound } from './sound';

export type Kind = 'tile' | 'ceramic' | 'metal' | 'plant';

/** m/s a held thing must be moving at for a touch to be a hit (a careful carry never is). */
const MIN_SPEED = 0.45;
/** Damage from a hit: 15 at MIN_SPEED up to 50 at MIN_SPEED + SPEED_SPAN; a weak point doubles it. */
const DMG = { min: 15, max: 50, crit: 2 };
const SPEED_SPAN = 1.6;
/** s before the same thing can be hit again (one swing through it is one hit). */
const COOLDOWN = 0.3;
/** s a broken thing stays broken before it builds itself back up. */
const REBUILD_AFTER = 15;
/** s the build-up takes. */
const BUILD_T = 0.6;
/** s the health bar and weak point stay up after the last hit. */
const BAR_T = 2.2;
/** m: how close to the weak point a hit lands to count as one. */
const WEAK_R = 0.03;
/** m: how much nearer or further than a target the held thing may be and still hit it (what lines up on screen does). */
const DEPTH_GAP = 0.12;
/** m: the same for the cat: it sits right at the front of the counter, so what covers it on screen nearly always passes in front of it. */
const CAT_DEPTH_GAP = 0.3;
/** cos of the widest angle between the held thing's travel and the target for a hit (60 degrees). */
const APPROACH = 0.5;
/** m: how far in front of the backsplash the held thing may be and still knock a tile. */
const WALL_GAP = 0.1;
/** px a damage number pops above the hit on a touch screen, so the fingertip doesn't cover it. */
const FINGER_LIFT = 52;
/** ms of buzz for a hit, a weak-point hit and a break, standing in on a phone for the screen shake a fingertip can't feel. */
const BUZZ = { hit: 12, crit: [12, 30, 22], break: [30, 20, 45] };
const MAX_CHUNKS = 260;
const WHITE = new THREE.Color(0xffffff);
const GRAVITY = 7;

const RATE: Record<Kind, number> = { tile: 1.35, ceramic: 1.2, metal: 1.55, plant: 0.8 };
const LAYER: Record<Kind, 'clink' | 'tink' | 'pat'> = { tile: 'clink', ceramic: 'clink', metal: 'tink', plant: 'pat' };

// ---- the backsplash ----------------------------------------------------------------------

/** The backsplash: 5 cm tiles up to 34 cm above the counter. */
export const TILES = { size: 0.05, h: 0.34, z: -0.549, width: 5 };
const TILE_GAP = 0.0045;
const TILE_D = 0.004;
const GROUT = 0xf4dcd6;
const TILE_CREAM = 0xfffaf3;
const TILE_PINK = 0xffd3dc;
/** The plaster behind a knocked-out tile. */
const HOLE = 0x9a7b72;

/**
 * The backsplash is one textured plane (cheap); a tile only becomes a mesh of its own while
 * something happens to it: a face that shakes and flashes when hit, a dark recess where it is
 * missing, a face that grows back blue when it rebuilds.
 */
export class TileWall {
  readonly cols = Math.round(TILES.width / TILES.size);
  readonly rows = Math.ceil(TILES.h / TILES.size);
  private readonly scene: THREE.Scene;
  private readonly faceGeo: THREE.ShapeGeometry;
  private readonly holeGeo: THREE.PlaneGeometry;
  private readonly holeMat = new THREE.MeshStandardMaterial({ color: HOLE, roughness: 1 });
  private readonly faces = new Map<number, THREE.Mesh>();
  private readonly holes = new Map<number, THREE.Mesh>();
  private readonly spareFaces: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const tiles = new THREE.Mesh(
      new THREE.PlaneGeometry(TILES.width, TILES.h),
      new THREE.MeshStandardMaterial({ map: tileTexture(TILES.width / TILES.size, TILES.h / TILES.size), emissive: 0xffffff, emissiveIntensity: 0.12, roughness: 0.6 }),
    );
    tiles.position.set(0, TILES.h / 2, TILES.z);
    tiles.receiveShadow = true;
    tiles.name = 'tiles';
    scene.add(tiles);
    // a tile's face: a flat rounded square, as the texture draws it (~16 triangles)
    const s = TILES.size - TILE_GAP, r = 0.006, h = s / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-h + r, -h);
    shape.lineTo(h - r, -h);
    shape.quadraticCurveTo(h, -h, h, -h + r);
    shape.lineTo(h, h - r);
    shape.quadraticCurveTo(h, h, h - r, h);
    shape.lineTo(-h + r, h);
    shape.quadraticCurveTo(-h, h, -h, h - r);
    shape.lineTo(-h, -h + r);
    shape.quadraticCurveTo(-h, -h, -h + r, -h);
    this.faceGeo = new THREE.ShapeGeometry(shape, 2);
    this.holeGeo = new THREE.PlaneGeometry(TILES.size - TILE_GAP * 0.3, TILES.size - TILE_GAP * 0.3);
  }

  /** The tile under a world point on the wall, or -1. */
  at(x: number, y: number) {
    const i = Math.floor((x + TILES.width / 2) / TILES.size);
    const j = Math.floor(y / TILES.size);
    if (i < 0 || i >= this.cols || j < 0 || j >= this.rows || y > TILES.h) return -1;
    return j * this.cols + i;
  }

  /** The middle of tile n (the top row is cut short under the trim). */
  centre(n: number, out = new THREE.Vector3()) {
    const i = n % this.cols, j = Math.floor(n / this.cols);
    const top = Math.min(TILES.h, (j + 1) * TILES.size);
    return out.set(-TILES.width / 2 + (i + 0.5) * TILES.size, (j * TILES.size + top) / 2, TILES.z);
  }

  /** How tall tile n is, as a fraction of a whole one. */
  heightOf(n: number) {
    const j = Math.floor(n / this.cols);
    return (Math.min(TILES.h, (j + 1) * TILES.size) - j * TILES.size) / TILES.size;
  }

  /** Tile n's colour, from the texture's pattern (its 4 x 4 repeat, rows counted down from the top of the canvas). */
  color(n: number) {
    const ci = (n % this.cols) % 4, cj = 3 - (Math.floor(n / this.cols) % 4);
    return new THREE.Color((ci * 3 + cj * 2) % 7 === 0 ? TILE_PINK : TILE_CREAM);
  }

  /** Tile n as a mesh of its own, over the texture (made on the first call). */
  face(n: number) {
    let f = this.faces.get(n);
    if (!f) {
      f = this.spareFaces.pop() ?? new THREE.Mesh(this.faceGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 0.12 }));
      (f.material as THREE.MeshStandardMaterial).color.copy(this.color(n));
      f.position.copy(this.centre(n)).setZ(TILES.z + TILE_D);
      f.scale.set(1, this.heightOf(n) - (1 - this.heightOf(n)) * 0.1, 1);
      f.receiveShadow = true;
      f.userData.home = f.position.clone();
      f.userData.sy = f.scale.y;
      this.scene.add(f);
      this.faces.set(n, f);
    }
    return f;
  }

  /** Back to the texture. */
  release(n: number) {
    const f = this.faces.get(n);
    if (!f) return;
    this.scene.remove(f);
    this.faces.delete(n);
    this.spareFaces.push(f);
  }

  /** Show or hide the recess where tile n was. */
  hole(n: number, show: boolean) {
    const h = this.holes.get(n);
    if (!show) { if (h) { this.scene.remove(h); this.holes.delete(n); } return; }
    if (h) return;
    const m = new THREE.Mesh(this.holeGeo, this.holeMat);
    m.position.copy(this.centre(n)).setZ(TILES.z + 0.0008);
    m.scale.y = this.heightOf(n);
    m.receiveShadow = true;
    this.scene.add(m);
    this.holes.set(n, m);
  }
}

/** Cream tiles with soft grout and a pink one here and there, repeated over the backsplash. */
function tileTexture(rx: number, ry: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4dcd6'; // grout
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      g.fillStyle = (i * 3 + j * 2) % 7 === 0 ? '#ffd3dc' : '#fffaf3';
      g.beginPath();
      g.roundRect(i * 64 + 3, j * 64 + 3, 58, 58, 8);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.7)'; // a glint on each tile's top-left
      g.beginPath();
      g.roundRect(i * 64 + 9, j * 64 + 8, 18, 5, 3);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx / 4, ry / 4);
  t.anisotropy = 4;
  return t;
}

// ---- breakables --------------------------------------------------------------------------

interface Target {
  name: string;
  kind: Kind;
  hp: number;
  max: number;
  /** World box (the scenery never moves). */
  box: THREE.Box3;
  centre: THREE.Vector3;
  /** An object, or a tile of the wall. */
  obj: THREE.Object3D | null;
  tile: number;
  meshes: THREE.Mesh[];
  mats: THREE.MeshStandardMaterial[];
  emissive: { color: THREE.Color; intensity: number }[];
  colors: THREE.Color[];
  home: THREE.Vector3;
  homeScaleY: number;
  cooldown: number;
  flash: number;
  shake: number;
  broken: boolean;
  brokenFor: number;
  /** 0..1 while it builds back up, else -1. */
  build: number;
  weak: THREE.Vector3 | null;
  barT: number;
}

interface Chunk { pos: THREE.Vector3; vel: THREE.Vector3; axis: THREE.Vector3; spin: number; angle: number; size: number; age: number; life: number; alive: boolean }
interface Puff { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; size: number; alive: boolean }

/** What Game needs to hear about. */
/** Something alive (the cat): it is hit like the scenery but never breaks; whoever added it reacts. */
interface Living { obj: THREE.Object3D; enabled: () => boolean; onHit: (at: THREE.Vector3, speed: number) => void; cooldown: number; box: THREE.Box3; centre: THREE.Vector3 }

export interface SmashEvents {
  /** Something gave way (its name, its kind and where it was). */
  broke(name: string, kind: Kind, at: THREE.Vector3): void;
}

export class Smash {
  readonly targets: Target[] = [];
  private readonly living: Living[] = [];
  /** The last few hits (what, with what, how fast, when), for the test driver. */
  private readonly hitLog: string[] = [];
  private logHit(name: string, speed: number) {
    this.hitLog.push(`${name} by ${this.weapon?.name || 'held'} at ${speed.toFixed(2)} m/s (t=${this.k.time.toFixed(1)})`);
    if (this.hitLog.length > 12) this.hitLog.shift();
  }
  /** Hits and breaks so far, for the test driver. */
  hits = 0;
  /** Of the hits, how many landed on the cat. */
  catHits = 0;
  breaks = 0;
  crits = 0;
  private readonly tileTargets = new Map<number, Target>();
  private readonly chunks: Chunk[] = [];
  private readonly chunkMesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly holo = new THREE.MeshBasicMaterial({ color: 0x6cc8ff, transparent: true, opacity: 0.55, depthWrite: false });
  private readonly layer: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly barText: HTMLElement;
  private readonly weakEl: HTMLElement;
  private barTarget: Target | null = null;
  private shakeAmp = 0;
  // the weapon
  private weapon: THREE.Object3D | null = null;
  private readonly wPrev = new THREE.Vector3();
  private readonly wVel = new THREE.Vector3();
  private readonly wBox = new THREE.Box3();
  private readonly wCentre = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly sPrev = new THREE.Vector2();
  private readonly sVel = new THREE.Vector2();
  private readonly s2 = new THREE.Vector2();
  private readonly s3 = new THREE.Vector2();
  private readonly sNow = new THREE.Vector2();
  private readonly wRect = new THREE.Box2();
  private readonly tRect = new THREE.Box2();
  private readonly ray = new THREE.Raycaster();
  private readonly wallPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -(TILES.z + TILE_D));
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly c = new THREE.Color();

  constructor(
    private readonly k: Kitchen,
    private readonly wall: TileWall,
    /** The thing the finger is swinging right now, or null. */
    private readonly held: () => THREE.Object3D | null,
    private readonly events: SmashEvents,
  ) {
    this.chunkMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, flatShading: true }),
      MAX_CHUNKS,
    );
    this.chunkMesh.frustumCulled = false;
    this.chunkMesh.castShadow = true;
    for (let i = 0; i < MAX_CHUNKS; i++) {
      this.chunks.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(0, 1, 0), spin: 0, angle: 0, size: 0, age: 0, life: 0, alive: false });
      this.chunkMesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
      this.chunkMesh.setColorAt(i, this.c.set(0xffffff));
    }
    k.scene.add(this.chunkMesh);
    for (let i = 0; i < 14; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xf6eee8, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
      mesh.visible = false;
      mesh.renderOrder = 3;
      k.scene.add(mesh);
      this.puffs.push({ mesh, mat, age: 0, life: 0, size: 0, alive: false });
    }
    // The overlay: damage numbers, the health bar and the weak point.
    this.layer = document.createElement('div');
    this.layer.className = 'smash-fx';
    this.bar = document.createElement('div');
    this.bar.className = 'hp';
    this.bar.hidden = true;
    this.barText = document.createElement('span');
    this.barText.className = 'hp-num';
    const track = document.createElement('div');
    track.className = 'hp-track';
    this.barFill = document.createElement('div');
    this.barFill.className = 'hp-fill';
    track.appendChild(this.barFill);
    this.bar.append(this.barText, track);
    this.weakEl = document.createElement('div');
    this.weakEl.className = 'weak';
    this.weakEl.hidden = true;
    this.layer.append(this.weakEl, this.bar);
    document.body.appendChild(this.layer);
    k.updaters.add((dt) => this.update(dt));
  }

  /** Something in the Kitchen that can be smashed. Its materials become its own, so its flash is its own. */
  add(name: string, obj: THREE.Object3D, kind: Kind, hp: number) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    const meshes: THREE.Mesh[] = [];
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const mats: THREE.MeshStandardMaterial[] = [];
    const colors: THREE.Color[] = [];
    for (const m of meshes) {
      const own = (m.material as THREE.MeshStandardMaterial).clone();
      m.material = own;
      m.userData.smashMat = own;
      mats.push(own);
      colors.push(own.color.clone());
    }
    this.targets.push({
      name, kind, hp, max: hp, box, centre: box.getCenter(new THREE.Vector3()), obj, tile: -1, meshes, mats,
      emissive: mats.map((m) => ({ color: m.emissive.clone(), intensity: m.emissiveIntensity })),
      colors, home: obj.position.clone(), homeScaleY: obj.scale.y, cooldown: 0, flash: 0, shake: 0, broken: false, brokenFor: 0, build: -1, weak: null, barT: Infinity,
    });
  }

  /** Something alive that can be hit (and reacts to it) but never breaks. */
  addLiving(obj: THREE.Object3D, enabled: () => boolean, onHit: (at: THREE.Vector3, speed: number) => void) {
    this.living.push({ obj, enabled, onHit, cooldown: 0, box: new THREE.Box3(), centre: new THREE.Vector3() });
  }

  /** A piece of scenery was moved (to keep it on screen): it lives there now. */
  moved(obj: THREE.Object3D) {
    const t = this.targets.find((x) => x.obj === obj);
    if (!t) return;
    obj.updateWorldMatrix(true, true);
    t.home.copy(obj.position);
    t.box.setFromObject(obj);
    t.box.getCenter(t.centre);
    t.weak = null;
  }

  /** Pop a mark (an anger vein over the cat) at a world point. */
  mark(at: THREE.Vector3, text: string, cls: string) {
    const s = this.k.toScreen(at);
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    el.style.left = `${Math.round(THREE.MathUtils.clamp(s.x, 24, window.innerWidth - 24))}px`;
    el.style.top = `${Math.round(THREE.MathUtils.clamp(s.y, 30, window.innerHeight - 30))}px`;
    this.layer.appendChild(el);
    window.setTimeout(() => el.remove(), 1000);
  }

  /** Every broken thing builds itself back up now (a new recipe begins). */
  rebuildAll() {
    for (const t of this.targets) if (t.broken && t.build < 0) this.startBuild(t);
    for (const t of this.tileTargets.values()) if (t.broken && t.build < 0) this.startBuild(t);
  }

  /** For the test driver. */
  info() {
    const all = [...this.targets, ...this.tileTargets.values()];
    return {
      hits: this.hits, breaks: this.breaks, crits: this.crits, catHits: this.catHits, hitLog: [...this.hitLog],
      living: this.living.map((l) => { const b = new THREE.Box3().setFromObject(l.obj); return { min: b.min.toArray().map((v) => +v.toFixed(3)), max: b.max.toArray().map((v) => +v.toFixed(3)), lo: this.k.toScreen(b.min), hi: this.k.toScreen(b.max) }; }),
      chunks: this.chunks.filter((c) => c.alive).length,
      speed: this.wVel.length(),
      weapon: this.weapon?.name || (this.weapon ? 'held' : null),
      bar: !this.bar.hidden, weak: !this.weakEl.hidden,
      targets: all.map((t) => ({
        name: t.name, kind: t.kind, hp: t.hp, max: t.max, broken: t.broken, building: t.build >= 0,
        screen: this.k.toScreen(t.centre),
        weak: t.weak ? this.k.toScreen(t.weak) : null,
        world: t.centre.toArray(),
      })),
    };
  }

  // ---- per frame ----------------------------------------------------------------------------

  private update(dt: number) {
    if (dt <= 0) return;
    for (const l of this.living) l.cooldown = Math.max(0, l.cooldown - dt);
    this.swing(dt);
    for (const t of this.targets) this.tick(t, dt);
    for (const t of this.tileTargets.values()) this.tick(t, dt);
    this.stepChunks(dt);
    this.stepPuffs(dt);
    this.overlay(dt);
    // The camera shakes after the rail has placed it, so the next frame's rail puts it back.
    if (this.shakeAmp > 1e-5) {
      const a = this.shakeAmp;
      this.k.camera.position.x += (Math.random() * 2 - 1) * a;
      this.k.camera.position.y += (Math.random() * 2 - 1) * a;
      this.shakeAmp *= Math.exp(-16 * dt);
    }
  }

  /**
   * Follow the held thing; a fast touch on the scenery is a hit. A hit is judged the way she
   * sees it: the held thing has to cover the target on screen and be about as far away as it.
   * On a portrait phone the camera looks steeply down, so a thing swung "through" the crock on
   * screen is really passing a few centimetres in front of it; boxes alone would never meet.
   */
  private swing(dt: number) {
    const w = this.held();
    if (w !== this.weapon) {
      this.weapon = w;
      this.wVel.set(0, 0, 0);
      this.sVel.set(0, 0);
      if (w) { this.wBox.setFromObject(w); this.wBox.getCenter(this.wPrev); this.sPrev.copy(this.ndc(this.wPrev)); }
      return;
    }
    if (!w) return;
    this.wBox.setFromObject(w);
    this.wBox.getCenter(this.wCentre);
    const raw = this.v.copy(this.wCentre).sub(this.wPrev).divideScalar(dt);
    this.wVel.lerp(raw, 0.6);
    this.wPrev.copy(this.wCentre);
    const sNow = this.sNow.copy(this.ndc(this.wCentre));
    this.sVel.lerp(this.s2.copy(sNow).sub(this.sPrev).divideScalar(dt), 0.6);
    this.sPrev.copy(sNow);
    const speed = this.wVel.length();
    if (speed < MIN_SPEED) return;
    const cam = this.k.camera.position;
    const wDist = cam.distanceTo(this.wCentre);
    const wRect = this.rect(this.wBox, this.wRect);
    // things on the counter
    for (const t of this.targets) {
      if (t.broken || t.cooldown > 0) continue;
      const tRect = this.rect(t.box, this.tRect);
      if (!this.wBox.intersectsBox(t.box) && !(rectsMeet(wRect, tRect) && this.nearInDepth(t.box, wDist))) continue;
      // moving into it on screen, not past it or pulling away
      const tc = this.ndc(t.centre);
      if (this.approach(tc, sNow) < APPROACH) continue;
      this.hit(t, this.landing(t.box), speed);
    }
    // the cat (never the thing it is being fed, never while it eats)
    for (const l of this.living) {
      if (l.cooldown > 0 || !l.enabled()) continue;
      l.box.setFromObject(l.obj);
      if (l.box.isEmpty()) continue;
      l.box.getCenter(l.centre);
      // the middle of the held thing has to pass over the cat (a carry brushing past it is not a hit)
      const cr = this.rect(l.box, this.tRect);
      const inX = sNow.x > cr.min.x && sNow.x < cr.max.x, inY = sNow.y > cr.min.y && sNow.y < cr.max.y;
      if (!(inX && inY && this.nearInDepth(l.box, wDist, CAT_DEPTH_GAP))) continue;
      const lc = this.ndc(l.centre);
      if (this.approach(lc, sNow) < APPROACH) continue;
      l.cooldown = 0.45;
      this.logHit('cat', speed);
      const at = this.landing(l.box);
      this.hits++;
      this.catHits++;
      sound.play('whack', { gain: 0.3, rate: 1.5 });
      sound.play('pat', { gain: 0.4, rate: 1.1 });
      this.shakeAmp = Math.max(this.shakeAmp, 0.002);
      buzz(BUZZ.hit);
      l.onHit(at, speed);
    }
    // the backsplash: up to two tiles nearest where it lands, seen through the held thing
    if (this.wVel.z >= 0 && this.sVel.y <= 0) return;
    const plane = this.wallPlane;
    const found: { n: number; d: number }[] = [];
    let centreHit: THREE.Vector3 | null = null;
    for (let gy = 0; gy <= 2; gy++) {
      for (let gx = 0; gx <= 2; gx++) {
        const x = THREE.MathUtils.lerp(wRect.min.x, wRect.max.x, gx / 2);
        const y = THREE.MathUtils.lerp(wRect.min.y, wRect.max.y, gy / 2);
        this.ray.setFromCamera(this.s2.set(x, y), this.k.camera);
        const p = this.ray.ray.intersectPlane(plane, this.v2);
        if (!p) continue;
        if (gx === 1 && gy === 1) centreHit = p.clone();
        // close enough to the wall to be touching it (the held thing is no further than WALL_GAP in front)
        if (cam.distanceTo(p) - wDist > WALL_GAP) continue;
        const n = this.wall.at(p.x, p.y);
        if (n < 0 || found.some((f) => f.n === n)) continue;
        found.push({ n, d: 0 });
      }
    }
    if (!found.length) return;
    const at = centreHit ?? this.wCentre;
    for (const f of found) { const c = this.wall.centre(f.n, this.v2); f.d = Math.hypot(c.x - at.x, c.y - at.y); }
    found.sort((a, b) => a.d - b.d);
    for (const { n } of found.slice(0, 2)) {
      const t = this.tileTarget(n);
      if (t.broken || t.cooldown > 0) continue;
      this.hit(t, t.centre.clone().setZ(TILES.z + TILE_D), speed);
    }
  }

  /**
   * How squarely the held thing is moving at a target on screen: 1 straight at it, 0 across,
   * below 0 away. A hit has to be heading at the thing (within 60 degrees), so a carry going
   * past it (the pan heading into the oven beside the canister) is not a hit, but a swing is.
   */
  private approach(target: THREE.Vector2, at: THREE.Vector2) {
    const a = this.k.camera.aspect; // NDC x to the same scale as y
    const dx = (target.x - at.x) * a, dy = target.y - at.y;
    const vx = this.sVel.x * a, vy = this.sVel.y;
    const d = Math.hypot(dx, dy), v = Math.hypot(vx, vy);
    if (v < 1e-6) return 0;
    if (d < 0.02) return 1; // right over its middle
    return (dx * vx + dy * vy) / (d * v);
  }

  /** NDC of a world point. */
  private ndc(p: THREE.Vector3) {
    this.v3.copy(p).project(this.k.camera);
    return this.s3.set(this.v3.x, this.v3.y);
  }

  /** A box's rectangle on screen (NDC). */
  private rect(b: THREE.Box3, out: THREE.Box2) {
    out.makeEmpty();
    for (let i = 0; i < 8; i++) {
      this.v3.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(this.k.camera);
      out.expandByPoint(this.s3.set(this.v3.x, this.v3.y));
    }
    return out;
  }

  /** The held thing is about as far from the camera as the box: not far in front of it, not behind it. */
  private nearInDepth(b: THREE.Box3, wDist: number, gap = DEPTH_GAP) {
    this.ray.ray.origin.copy(this.k.camera.position);
    this.ray.ray.direction.copy(this.wCentre).sub(this.k.camera.position).normalize();
    const p = this.ray.ray.intersectBox(b, this.v3);
    const d = p ? this.k.camera.position.distanceTo(p) : this.k.camera.position.distanceTo(b.getCenter(this.v3));
    return d - wDist < gap && wDist - d < gap;
  }

  /** Where on the box the hit lands: where her eye, through the held thing, meets it. */
  private landing(b: THREE.Box3) {
    this.ray.ray.origin.copy(this.k.camera.position);
    this.ray.ray.direction.copy(this.wCentre).sub(this.k.camera.position).normalize();
    return this.ray.ray.intersectBox(b, new THREE.Vector3()) ?? b.clampPoint(this.wCentre, new THREE.Vector3());
  }

  private tileTarget(n: number) {
    let t = this.tileTargets.get(n);
    if (!t) {
      const c = this.wall.centre(n);
      const h = TILES.size / 2;
      t = {
        name: `tile${n}`, kind: 'tile', hp: 40, max: 40,
        box: new THREE.Box3(new THREE.Vector3(c.x - h, c.y - h, TILES.z), new THREE.Vector3(c.x + h, c.y + h, TILES.z + TILE_D)),
        centre: c, obj: null, tile: n, meshes: [], mats: [], emissive: [], colors: [this.wall.color(n), new THREE.Color(GROUT)],
        home: c.clone(), homeScaleY: 1, cooldown: 0, flash: 0, shake: 0, broken: false, brokenFor: 0, build: -1, weak: null, barT: Infinity,
      };
      this.tileTargets.set(n, t);
    }
    return t;
  }

  private hit(t: Target, at: THREE.Vector3, speed: number) {
    const u = THREE.MathUtils.clamp((speed - MIN_SPEED) / SPEED_SPAN, 0, 1);
    let dmg = Math.round(DMG.min + (DMG.max - DMG.min) * u);
    // the weak point: on the side facing the camera, a hit near it counts double and it moves on
    const crit = !!t.weak && Math.hypot(at.x - t.weak.x, at.y - t.weak.y) < WEAK_R;
    if (crit) { dmg *= DMG.crit; this.crits++; }
    t.hp = Math.max(0, t.hp - dmg);
    t.cooldown = COOLDOWN;
    this.logHit(t.name, speed);
    t.flash = 1;
    t.shake = 1;
    t.barT = 0;
    this.hits++;
    this.barTarget = t;
    if (t.kind !== 'tile' && (crit || !t.weak)) t.weak = this.weakSpot(t);
    this.number(at, dmg, crit);
    this.chips(t, at, 3 + Math.round(3 * u));
    const r = RATE[t.kind];
    sound.play('whack', { gain: 0.45 + 0.4 * u, rate: r });
    sound.play(LAYER[t.kind], { gain: 0.35, rate: 0.9 });
    if (crit) sound.play('crit', { gain: 0.8 });
    if (t.hp > 0) buzz(crit ? BUZZ.crit : BUZZ.hit);
    this.shakeAmp = Math.max(this.shakeAmp, 0.0015 + 0.0015 * u);
    if (t.hp <= 0) this.breakIt(t);
  }

  /** A random spot on the side facing the camera, inside the middle of that face. */
  private weakSpot(t: Target) {
    const b = t.box;
    return new THREE.Vector3(
      THREE.MathUtils.lerp(b.min.x, b.max.x, 0.25 + Math.random() * 0.5),
      THREE.MathUtils.lerp(b.min.y, b.max.y, 0.25 + Math.random() * 0.5),
      b.max.z,
    );
  }

  private breakIt(t: Target) {
    t.broken = true;
    t.brokenFor = 0;
    t.weak = null;
    t.barT = BAR_T - 0.35; // the bar shows its zero for a moment, then goes
    this.breaks++;
    if (t.obj) t.obj.visible = false;
    else {
      this.wall.release(t.tile);
      this.wall.hole(t.tile, true);
    }
    const size = t.box.getSize(this.v2);
    const vol = size.x * size.y * size.z;
    const n = t.kind === 'tile' ? 7 : THREE.MathUtils.clamp(Math.round(vol / 0.000035), 12, 30);
    const big = t.kind === 'tile' ? 0.008 : THREE.MathUtils.clamp(Math.cbrt(vol) * 0.22, 0.008, 0.016);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(
        THREE.MathUtils.lerp(t.box.min.x, t.box.max.x, Math.random()),
        THREE.MathUtils.lerp(t.box.min.y, t.box.max.y, Math.random()),
        THREE.MathUtils.lerp(t.box.min.z, t.box.max.z, Math.random()),
      );
      const out = this.v.copy(p).sub(t.centre);
      out.y = 0;
      if (t.kind === 'tile') out.set((Math.random() - 0.5) * 0.8, 0, 0.6 + Math.random() * 0.6);
      else out.normalize().multiplyScalar(0.35 + Math.random() * 0.8);
      const vel = new THREE.Vector3(out.x, (t.kind === 'tile' ? 0.3 : 0.8) + Math.random() * 1.1, out.z).addScaledVector(this.wVel, 0.25);
      this.spawnChunk(p, vel, big * (0.45 + Math.random() * 0.55), t.colors[Math.floor(Math.random() * t.colors.length)], 0.55 + Math.random() * 0.45);
    }
    // a puff of dust where it stood
    for (let i = 0; i < (t.kind === 'tile' ? 3 : 6); i++) {
      const p = t.centre.clone().add(new THREE.Vector3((Math.random() - 0.5) * size.x, (Math.random() - 0.5) * size.y * 0.6, (Math.random() - 0.5) * size.z));
      this.spawnPuff(p, Math.max(size.x, size.y) * (0.35 + Math.random() * 0.3));
    }
    sound.play('smash', { gain: t.kind === 'tile' ? 0.55 : 0.85, rate: RATE[t.kind] * 0.85 });
    this.shakeAmp = Math.max(this.shakeAmp, t.kind === 'tile' ? 0.003 : 0.006);
    buzz(BUZZ.break);
    this.events.broke(t.name, t.kind, t.centre.clone());
  }

  private startBuild(t: Target) {
    t.build = 0;
    sound.play('build', { gain: 0.5 });
    if (t.obj) {
      t.obj.visible = true;
      for (const m of t.meshes) m.material = this.holo;
      t.obj.scale.y = 0.001;
      t.obj.position.copy(t.home);
    }
  }

  private tick(t: Target, dt: number) {
    t.cooldown = Math.max(0, t.cooldown - dt);
    t.barT += dt;
    if (t.broken && t.build < 0) {
      t.brokenFor += dt;
      if (t.brokenFor >= REBUILD_AFTER) this.startBuild(t);
      return;
    }
    if (t.build >= 0) {
      t.build = Math.min(1, t.build + dt / BUILD_T);
      const e = 1 - (1 - t.build) ** 3;
      if (t.obj) t.obj.scale.y = Math.max(0.001, e) * t.homeScaleY;
      else {
        // a tile pops back into its gap, blue first, then its own colour
        const f = this.wall.face(t.tile);
        const s = Math.max(0.001, e);
        f.scale.set(s, f.userData.sy * s, 1);
        (f.material as THREE.MeshStandardMaterial).color.set(0x6cc8ff).lerp(this.wall.color(t.tile), t.build);
      }
      if (t.build >= 1) {
        t.build = -1;
        t.broken = false;
        t.hp = t.max;
        t.flash = 0.6;
        if (t.obj) { t.obj.scale.y = t.homeScaleY; t.meshes.forEach((m, i) => { m.material = t.mats[i]; }); }
        else { this.wall.release(t.tile); this.wall.hole(t.tile, false); }
        sound.play('pop', { gain: 0.35 });
      }
      return;
    }
    // shake and flash after a hit
    if (t.shake > 0 || t.flash > 0) {
      t.shake = Math.max(0, t.shake - dt / 0.16);
      t.flash = Math.max(0, t.flash - dt / 0.1);
      const a = 0.004 * t.shake * t.shake;
      if (t.obj) {
        t.obj.position.set(t.home.x + (Math.random() * 2 - 1) * a, t.home.y, t.home.z + (Math.random() * 2 - 1) * a);
        t.mats.forEach((m, i) => {
          m.emissive.copy(t.emissive[i].color).lerp(WHITE, t.flash);
          m.emissiveIntensity = THREE.MathUtils.lerp(t.emissive[i].intensity, 0.9, t.flash);
        });
      } else {
        // the tile comes loose for a moment: its own face, jiggling and flashing over the texture
        const f = this.wall.face(t.tile);
        const home = f.userData.home as THREE.Vector3;
        f.position.set(home.x + (Math.random() * 2 - 1) * a, home.y + (Math.random() * 2 - 1) * a, home.z);
        (f.material as THREE.MeshStandardMaterial).color.copy(this.wall.color(t.tile)).lerp(WHITE, t.flash * 0.8).multiplyScalar(1 + t.flash * 0.6);
        if (t.shake <= 0 && t.flash <= 0) this.wall.release(t.tile);
      }
    }
  }

  // ---- debris -------------------------------------------------------------------------------

  /** A few chips knocked off on a hit. */
  private chips(t: Target, at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const vel = new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.5 + Math.random() * 0.8, 0.3 + Math.random() * 0.5);
      this.spawnChunk(at.clone(), vel, 0.0025 + Math.random() * 0.003, t.colors[Math.floor(Math.random() * t.colors.length)], 0.35 + Math.random() * 0.25);
    }
  }

  private spawnChunk(pos: THREE.Vector3, vel: THREE.Vector3, size: number, color: THREE.Color, life: number) {
    const i = this.chunks.findIndex((c) => !c.alive);
    if (i < 0) return;
    const c = this.chunks[i];
    c.pos.copy(pos);
    c.vel.copy(vel);
    c.axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    c.spin = (Math.random() * 2 - 1) * 18;
    c.angle = Math.random() * 6;
    c.size = size;
    c.age = 0;
    c.life = life;
    c.alive = true;
    this.chunkMesh.setColorAt(i, color);
    this.chunkMesh.instanceColor!.needsUpdate = true;
  }

  private stepChunks(dt: number) {
    let any = false;
    this.chunks.forEach((c, i) => {
      if (!c.alive) return;
      any = true;
      c.age += dt;
      if (c.age >= c.life) {
        c.alive = false;
        this.chunkMesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        return;
      }
      c.vel.y -= GRAVITY * dt;
      c.pos.addScaledVector(c.vel, dt);
      // the counter and the wall
      if (c.pos.y < c.size) { c.pos.y = c.size; c.vel.y = Math.abs(c.vel.y) * 0.35; c.vel.x *= 0.6; c.vel.z *= 0.6; c.spin *= 0.6; }
      if (c.pos.z < TILES.z + c.size) { c.pos.z = TILES.z + c.size; c.vel.z = Math.abs(c.vel.z) * 0.3; }
      c.angle += c.spin * dt;
      // a pop in, then they shrink away (nothing lies about afterwards)
      const s = c.size * Math.min(1, c.age / 0.04) * Math.min(1, (c.life - c.age) / 0.22);
      this.m4.compose(c.pos, this.q.setFromAxisAngle(c.axis, c.angle), this.v.set(s, s * 0.8, s * 1.1));
      this.chunkMesh.setMatrixAt(i, this.m4);
    });
    if (any) this.chunkMesh.instanceMatrix.needsUpdate = true;
  }

  private spawnPuff(at: THREE.Vector3, size: number) {
    const p = this.puffs.find((x) => !x.alive);
    if (!p) return;
    p.alive = true;
    p.age = 0;
    p.life = 0.45 + Math.random() * 0.25;
    p.size = size;
    p.mesh.position.copy(at);
    p.mesh.visible = true;
  }

  private stepPuffs(dt: number) {
    for (const p of this.puffs) {
      if (!p.alive) continue;
      p.age += dt;
      const u = p.age / p.life;
      if (u >= 1) { p.alive = false; p.mesh.visible = false; continue; }
      p.mesh.scale.setScalar(p.size * (0.4 + 0.8 * (1 - (1 - u) ** 2)));
      p.mesh.position.y += 0.04 * dt;
      p.mat.opacity = 0.6 * (1 - u) * Math.min(1, p.age / 0.05);
    }
  }

  // ---- the overlay ---------------------------------------------------------------------------

  /** A damage number popping off the hit and floating up. */
  private number(at: THREE.Vector3, dmg: number, crit: boolean) {
    const s = this.k.toScreen(at);
    const el = document.createElement('span');
    el.className = crit ? 'dmg crit' : 'dmg';
    el.textContent = String(dmg);
    el.style.left = `${Math.round(THREE.MathUtils.clamp(s.x + (Math.random() - 0.5) * 30, 28, window.innerWidth - 28))}px`;
    el.style.top = `${Math.round(THREE.MathUtils.clamp(s.y - 10 - (touch() ? FINGER_LIFT : 0), 30, window.innerHeight - 30))}px`;
    this.layer.appendChild(el);
    window.setTimeout(() => el.remove(), 950);
  }

  private overlay(dt: number) {
    void dt;
    const t = this.barTarget;
    const show = !!t && t.barT < BAR_T && t.build < 0;
    this.bar.hidden = !show;
    if (t && show) {
      const top = this.k.toScreen(this.v.set(t.centre.x, t.box.max.y + 0.025, t.centre.z));
      this.bar.style.left = `${Math.round(THREE.MathUtils.clamp(top.x, 64, window.innerWidth - 64))}px`;
      this.bar.style.top = `${Math.round(THREE.MathUtils.clamp(top.y, 40, window.innerHeight - 20))}px`;
      this.barFill.style.width = `${(100 * t.hp) / t.max}%`;
      this.barText.textContent = `${t.hp} | ${t.max}`;
    }
    const weak = t && show && !t.broken && t.weak;
    this.weakEl.hidden = !weak;
    if (t && weak && t.weak) {
      const w = this.k.toScreen(t.weak);
      this.weakEl.style.left = `${Math.round(w.x)}px`;
      this.weakEl.style.top = `${Math.round(w.y)}px`;
    }
  }
}

/** Is this a touch screen (her phone), where a finger covers what it hits. */
const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** A short buzz where the phone can (Android; iOS has no web vibration and ignores it). */
function buzz(pattern: number | number[]) {
  try { if (touch()) navigator.vibrate?.(pattern); } catch { /* no buzz */ }
}

function rectsMeet(a: THREE.Box2, b: THREE.Box2) {
  return a.max.x >= b.min.x && a.min.x <= b.max.x && a.max.y >= b.min.y && a.min.y <= b.max.y;
}

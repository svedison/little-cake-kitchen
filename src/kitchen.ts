// The Kitchen: the one 3D room everything happens in. Rendering, physics, the camera
// rail, pointer input, and the long counter the three Stations share.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Pointer } from './input';
import { Rail, STATION_X } from './camera';
import { motion, easeInOutCubic } from './motion';
import { TileWall, TILES } from './smash';

export const P = {
  cream: 0xfff6e9,
  pink: 0xffb6c1,
  cocoa: 0x6b4a3a,
  matcha: 0xb9d8a8,
  butter: 0xffe8a3,
  glass: 0xddeff7,
  wood: 0xf3dcc0,
  wall: 0xffe4e8,
  shell: 0xf8ecd9,
  yolk: 0xffb340,
  white: 0xfff6dc,
  paper: 0xf2e6d0,
  steel: 0xcdd3db,
};

/**
 * Where things sit at a Station, relative to the Station's x. Nothing ever shares a slot:
 * a prop that is not part of the current Step is parked off the right edge of the view.
 */
export const SLOT = {
  // A touch right of centre so the cat fits on its left; the pan below it is still centred.
  bowl: new THREE.Vector3(0.03, 0, -0.06),
  front: new THREE.Vector3(0, 0, 0.15),
  // Tuned by eye: a 390 px phone only shows |x| < 0.145 this close to the camera. A pan at
  // frontRight just fits; a prop at frontLeft must be small (0.11 m) and sits a little back.
  frontLeft: new THREE.Vector3(-0.085, 0, 0.12),
  frontRight: new THREE.Vector3(0.03, 0, 0.15),
  side: new THREE.Vector3(0.17, 0, 0.1),
  /** Off the right edge at every viewport; props slide in from and out to here. */
  park: new THREE.Vector3(0.6, 0, 0.17),
  /** Off the left edge, for the bowl once the cake is out. */
  bowlAway: new THREE.Vector3(-0.55, 0, -0.06),
  // Behind the bowl's back-left with a gap to its rim: both paws show past it, and the hat
  // stays under the step header on a phone even mid-hop (further back it is not). Tuned by eye.
  cat: new THREE.Vector3(-0.14, 0, -0.15),
};

export type CollisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => void;

/** Convex hull of 2D points (Andrew's monotone chain), counter-clockwise, no repeats. */
function convexHull(pts: [number, number][]) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

const STEP = 1 / 60;

export class Kitchen {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 8);
  readonly renderer: THREE.WebGLRenderer;
  readonly world: RAPIER.World;
  readonly pointer: Pointer;
  readonly rail: Rail;
  readonly updaters = new Set<(dt: number, t: number) => void>();
  /** Called after the screen changes size or shape (the Game keeps its scenery in view). */
  readonly resized = new Set<() => void>();
  readonly onCollision = new Set<CollisionHandler>();
  /** Smoothed frames per second, for tuning on a real phone. */
  fps = 60;
  time = 0;
  /** The backsplash, tile by tile. */
  tiles!: TileWall;
  /** Game seconds run this many times slower than real ones (`?slowmo=4`); for looking at pours. */
  slowmo = Math.max(1, Number(new URLSearchParams(location.search).get('slowmo')) || 1);
  /** The biggest camera jump (a move in one frame that no timeline or swipe explains) since resetRailStats(); a test driver watches it. */
  railMaxStepDx = 0;

  private readonly events = new RAPIER.EventQueue(true);
  private readonly raycaster = new THREE.Raycaster();
  private readonly sun: THREE.DirectionalLight;
  private acc = 0;
  private last = performance.now();

  static async create(canvas: HTMLCanvasElement) {
    await RAPIER.init();
    return new Kitchen(canvas);
  }

  private constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(P.cream);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;

    this.pointer = new Pointer(canvas);
    this.rail = new Rail(this.camera);
    this.pointer.swipe = this.rail;

    this.sun = this.addLights();
    this.addCounter();

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  start() {
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Draw one frame as things stand (behind the title card, or after the context comes back). */
  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** A ray from the camera through a screen point. */
  ray(clientX: number, clientY: number) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.clone();
  }

  /** Where a ray crosses the horizontal plane at height y (null if it never does). */
  pointOnPlane(ray: THREE.Ray, y: number) {
    if (Math.abs(ray.direction.y) < 1e-6) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return ray.origin.clone().addScaledVector(ray.direction, t);
  }

  /** Finger position projected onto the plane at height y. */
  fingerAt(x: number, y: number, planeY: number) {
    return this.pointOnPlane(this.ray(x, y), planeY);
  }

  /** World point to CSS pixel coordinates. */
  toScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  /** CSS pixel distance between a finger and a world point. */
  screenDist(x: number, y: number, p: THREE.Vector3) {
    const s = this.toScreen(p);
    return Math.hypot(s.x - x, s.y - y);
  }

  /** World position of a slot at the current Station. */
  at(slot: THREE.Vector3, station?: number) {
    return slot.clone().setX(slot.x + (station ?? 0));
  }

  resetRailStats() { this.railMaxStepDx = 0; }

  /** Slide a prop along the counter to a slot, easing in and out; resolves when it is there. */
  glide(obj: THREE.Object3D, to: THREE.Vector3, seconds: number) {
    const from = obj.position.clone();
    const dest = to.clone();
    return motion.tween(seconds, easeInOutCubic, (k) => { obj.position.lerpVectors(from, dest, k); });
  }

  /**
   * World-space bounding box of an object's visible meshes and the screen rectangle they
   * cover, in CSS pixels. Both come from every vertex: a tilted jug gets a tight box, and
   * a round pan's rectangle is its real silhouette, not the projection of a box's corners
   * (which would read 60 px too wide for a pan near the bottom of a phone screen).
   */
  boxOf(obj: THREE.Object3D) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    const pts: [number, number][] = [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    obj.traverseVisible((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const pos = mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
        pts.push([v.x, v.z]);
        const s = this.toScreen(v);
        x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y);
      }
    });
    if (box.isEmpty()) return null;
    return {
      world: { min: box.min.toArray(), max: box.max.toArray() },
      screen: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
      // Footprint on the counter: a round bowl and a round cat side by side have crossing
      // boxes but separate hulls, so the driver tests hulls, not boxes, for "touching".
      hull: convexHull(pts),
    };
  }

  private frame() {
    const now = performance.now();
    const real = Math.min((now - this.last) / 1000, 0.1);
    const dt = real / this.slowmo;
    this.last = now;
    this.time += dt;
    this.fps += (1 / Math.max(real, 1e-3) - this.fps) * 0.05;

    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 4) {
      this.world.step(this.events);
      this.events.drainCollisionEvents((h1, h2, started) => {
        if (!started) return;
        const a = this.world.getCollider(h1);
        const b = this.world.getCollider(h2);
        if (a && b) for (const f of this.onCollision) f(a, b);
      });
      this.acc -= STEP;
      steps++;
    }
    if (steps === 4) this.acc = 0; // tab was hidden; don't try to catch up

    // A rail on a timeline or under a finger moves on purpose; any other move is a jump.
    const railX = this.rail.x;
    const deliberate = this.rail.moving;
    this.rail.update(dt);
    if (!deliberate) this.railMaxStepDx = Math.max(this.railMaxStepDx, Math.abs(this.rail.x - railX));
    this.sun.position.set(this.rail.x + 0.45, 1.1, 0.55);
    this.sun.target.position.set(this.rail.x, 0, 0);
    motion.update(dt);
    for (const u of this.updaters) u(dt, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // The rail owns the pose and the field of view; 6/5 is also where style.css lays the header top-left.
    this.rail.landscape = this.camera.aspect > 1.2;
    this.rail.update(0);
    for (const f of this.resized) f();
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0xf2cfc4, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(0.45, 1.1, 0.55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.2;
    sun.shadow.camera.far = 3;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -0.6;
    sun.shadow.camera.right = sun.shadow.camera.top = 0.6;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.002;
    this.scene.add(sun);
    this.scene.add(sun.target);
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.6);
    fill.position.set(-0.6, 0.5, 0.3);
    this.scene.add(fill);
    return sun;
  }

  private addCounter() {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(3.6, 0.04, 1.1),
      new THREE.MeshStandardMaterial({ color: P.wood, roughness: 0.9 }),
    );
    top.position.y = -0.02;
    top.receiveShadow = true;
    this.scene.add(top);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 1.6),
      new THREE.MeshStandardMaterial({ color: P.wall, emissive: P.wall, emissiveIntensity: 0.35, roughness: 1 }),
    );
    wall.position.set(0, 0.75, -0.55);
    this.scene.add(wall);
    // A tiled backsplash along the counter, so no Station looks onto a bare wall (smash.ts can knock its tiles out).
    this.tiles = new TileWall(this.scene);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(5, 0.012, 0.012), new THREE.MeshStandardMaterial({ color: P.pink, roughness: 0.6 }));
    trim.position.set(0, TILES.h, -0.544);
    this.scene.add(trim);

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.02, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.8, 0.02, 0.55).setFriction(0.9), body);
  }
}

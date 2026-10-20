// The Kitchen: the one 3D room everything happens in. Rendering, physics, the camera
// rail, pointer input, and the long counter the three Stations share.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { Pointer } from './input';
import { Rail } from './camera';

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

/** Where things sit at a Station, relative to the Station's x. */
export const SLOT = {
  bowl: new THREE.Vector3(0, 0, -0.06),
  front: new THREE.Vector3(0, 0, 0.17),
  side: new THREE.Vector3(0.17, 0, 0.1),
  cat: new THREE.Vector3(-0.135, 0, -0.25),
};

export type CollisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => void;

const STEP = 1 / 60;

export class Kitchen {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 8);
  readonly renderer: THREE.WebGLRenderer;
  readonly world: RAPIER.World;
  readonly pointer: Pointer;
  readonly rail: Rail;
  readonly updaters = new Set<(dt: number, t: number) => void>();
  readonly onCollision = new Set<CollisionHandler>();
  /** Smoothed frames per second, for tuning on a real phone. */
  fps = 60;
  time = 0;

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

  private frame() {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    this.time += dt;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;

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

    this.rail.update(dt);
    this.sun.position.set(this.rail.x + 0.45, 1.1, 0.55);
    this.sun.target.position.set(this.rail.x, 0, 0);
    for (const u of this.updaters) u(dt, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones need a wider vertical field so the bowl and the front slot both fit.
    this.camera.fov = this.camera.aspect < 0.75 ? 58 : this.camera.aspect < 1.2 ? 48 : 40;
    this.camera.updateProjectionMatrix();
    this.rail.landscape = this.camera.aspect > 1.2;
    this.rail.update(0);
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

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.02, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(1.8, 0.02, 0.55).setFriction(0.9), body);
  }
}

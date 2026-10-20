// The Kitchen: the one 3D room everything happens in. For the vertical slice it
// is just the Counter station: counter top, a wall, a bowl, lights and physics.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

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
};

export interface Bowl {
  center: THREE.Vector3;
  rimRadius: number;
  rimY: number;
  floorY: number;
  collider: RAPIER.Collider;
}

export type CollisionHandler = (a: RAPIER.Collider, b: RAPIER.Collider) => void;

const STEP = 1 / 60;

export class Kitchen {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 6);
  readonly renderer: THREE.WebGLRenderer;
  readonly world: RAPIER.World;
  readonly bowl: Bowl;
  readonly counterCollider: RAPIER.Collider;
  readonly updaters = new Set<(dt: number, t: number) => void>();
  readonly onCollision = new Set<CollisionHandler>();
  /** Smoothed frames per second, for tuning on a real phone. */
  fps = 60;

  private readonly events = new RAPIER.EventQueue(true);
  private readonly raycaster = new THREE.Raycaster();
  private acc = 0;
  private last = performance.now();
  private time = 0;

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

    this.camera.position.set(0, 0.5, 0.42);
    this.camera.lookAt(0, 0.02, -0.02);

    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;

    this.addLights();
    this.counterCollider = this.addCounter();
    this.bowl = this.addBowl(new THREE.Vector3(0, 0, -0.06));

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

  /** World point to CSS pixel coordinates. */
  toScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
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

    for (const u of this.updaters) u(dt, this.time);
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones need a wider vertical field so the bowl and carton both fit.
    this.camera.fov = this.camera.aspect < 0.75 ? 58 : this.camera.aspect < 1.2 ? 48 : 40;
    this.camera.updateProjectionMatrix();
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight(0xfff8ee, 0xf2cfc4, 1.1));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(0.45, 1.1, 0.55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.2;
    sun.shadow.camera.far = 3;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -0.5;
    sun.shadow.camera.right = sun.shadow.camera.top = 0.5;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.002;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xdde8ff, 0.6);
    fill.position.set(-0.6, 0.5, 0.3);
    this.scene.add(fill);
  }

  private addCounter() {
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.04, 1.1),
      new THREE.MeshStandardMaterial({ color: P.wood, roughness: 0.9 }),
    );
    top.position.y = -0.02;
    top.receiveShadow = true;
    this.scene.add(top);

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 1.5),
      new THREE.MeshStandardMaterial({ color: P.wall, emissive: P.wall, emissiveIntensity: 0.35, roughness: 1 }),
    );
    wall.position.set(0, 0.7, -0.55);
    this.scene.add(wall);

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.02, 0));
    return this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.02, 0.55).setFriction(0.9), body);
  }

  private addBowl(center: THREE.Vector3): Bowl {
    // Outside goes up from the base to the rim, then the inside comes back down to the floor.
    const profile = [
      [0, 0], [0.08, 0], [0.12, 0.045], [0.135, 0.095],
      [0.125, 0.095], [0.11, 0.05], [0.07, 0.006], [0, 0.006],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(profile, 64);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: P.matcha, roughness: 0.45, side: THREE.DoubleSide }));
    mesh.position.copy(center);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z));
    const verts = geo.attributes.position.array as Float32Array;
    const idx = Uint32Array.from(geo.index!.array);
    const collider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(verts, idx).setFriction(0.8), body);
    return { center, rimRadius: 0.13, rimY: 0.095, floorY: 0.006, collider };
  }
}

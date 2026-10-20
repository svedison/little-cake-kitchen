// A burst of little paper squares over the finished cake.
import * as THREE from 'three';

const COLORS = [0xffb6c1, 0xffe8a3, 0xb9d8a8, 0xddeff7, 0xffffff];
const N = 90;

export class Confetti {
  private readonly mesh: THREE.InstancedMesh;
  private readonly pos: THREE.Vector3[] = [];
  private readonly vel: THREE.Vector3[] = [];
  private readonly rot: THREE.Euler[] = [];
  private readonly spin: THREE.Vector3[] = [];
  private age = 99;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3(1, 1, 1);

  constructor(private readonly scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.012, 0.008), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), N);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < N; i++) {
      this.pos.push(new THREE.Vector3());
      this.vel.push(new THREE.Vector3());
      this.rot.push(new THREE.Euler());
      this.spin.push(new THREE.Vector3());
      this.mesh.setColorAt(i, new THREE.Color(COLORS[i % COLORS.length]));
    }
    scene.add(this.mesh);
  }

  burst(at: THREE.Vector3) {
    this.age = 0;
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.6 + Math.random() * 0.8;
      this.pos[i].copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.04, 0.02, (Math.random() - 0.5) * 0.04));
      this.vel[i].set(Math.cos(a) * r * 0.35, 0.9 + Math.random() * 0.9, Math.sin(a) * r * 0.35);
      this.rot[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.spin[i].set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    }
    this.mesh.visible = true;
  }

  update(dt: number) {
    if (!this.mesh.visible) return;
    this.age += dt;
    if (this.age > 3.2) { this.mesh.visible = false; return; }
    for (let i = 0; i < N; i++) {
      const v = this.vel[i];
      v.y -= 2.2 * dt;
      v.multiplyScalar(Math.exp(-1.6 * dt));
      const p = this.pos[i].addScaledVector(v, dt);
      if (p.y < 0.004) { p.y = 0.004; v.set(0, 0, 0); this.spin[i].set(0, 0, 0); }
      const r = this.rot[i];
      r.x += this.spin[i].x * dt; r.y += this.spin[i].y * dt; r.z += this.spin[i].z * dt;
      this.q.setFromEuler(r);
      this.m.compose(p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

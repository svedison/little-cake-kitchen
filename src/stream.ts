// A pour: a bent tube from a spout to a landing point. Not a fluid, just a shape that
// follows the hand (ADR-0002).
import * as THREE from 'three';

export class Stream {
  readonly mesh: THREE.Mesh;
  readonly from = new THREE.Vector3();
  readonly to = new THREE.Vector3();
  radius = 0.006;
  flow = 0; // 0..1, scales the radius
  private readonly mat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, color: number) {
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.3 });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.mesh.castShadow = true;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setColor(hex: number) { this.mat.color.set(hex); }

  update(t: number) {
    const r = this.radius * this.flow;
    if (r < 0.0005) { this.mesh.visible = false; return; }
    const mid = this.from.clone().lerp(this.to, 0.5);
    mid.y = Math.min(this.from.y, mid.y) - 0.01;
    mid.x += Math.sin(t * 9) * 0.004 * this.flow;
    const curve = new THREE.QuadraticBezierCurve3(this.from, mid, this.to);
    this.mesh.geometry.dispose();
    this.mesh.geometry = new THREE.TubeGeometry(curve, 14, r, 8, false);
    this.mesh.visible = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

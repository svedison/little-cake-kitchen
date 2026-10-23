// A burst of little paper squares over the finished cake: a ParticlePool that lands
// on the counter and lies there.
import * as THREE from 'three';
import { ParticlePool } from './particles';
import { sound } from './sound';

const COLORS = [0xffb6c1, 0xffe8a3, 0xb9d8a8, 0xddeff7, 0xffffff];
const N = 90;
const LIFE = 3.2;

export class Confetti {
  private readonly pool: ParticlePool;

  constructor(scene: THREE.Scene) {
    this.pool = new ParticlePool(
      new THREE.PlaneGeometry(0.012, 0.008),
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }),
      N,
      // light paper: weak gravity, lots of drag, a little flutter; rests on the counter top
      { gravity: 2.2, drag: 1.6, jitter: 0.5, floorY: 0.004, floor: 'rest', fade: 0.3 },
    );
    scene.add(this.pool.mesh);
  }

  burst(at: THREE.Vector3) {
    this.pool.clear();
    // a party popper going off, and two little bells (kept under the egg crack's level)
    sound.play('pop', { gain: 0.6, rate: 0.8 });
    sound.play('cheer', { gain: 0.7, delay: 0.06 });
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.6 + Math.random() * 0.8) * 0.35; // outward speed, m/s
      this.pool.emit({
        at: { x: at.x, y: at.y + 0.02, z: at.z },
        spread: 0.02,
        vel: { x: Math.cos(a) * r, y: 1.35, z: Math.sin(a) * r },
        velJitter: 0.45,
        life: LIFE,
        spin: 12,
        color: COLORS[i % COLORS.length],
      });
    }
  }

  update(dt: number) { this.pool.update(dt); }
}

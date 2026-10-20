// The chef cat: a round body with a flat cartoon face that swaps expressions.
import * as THREE from 'three';
import { P } from './kitchen';
import type { Kitchen } from './kitchen';
import type { Hud } from './hud';

export type Expr = 'idle' | 'excited' | 'ooh' | 'sleepy' | 'yum' | 'meh' | 'love';

const FUR = 0xffe3c2;
const EAR = 0xffb6c1;

export class Cat {
  readonly group = new THREE.Group();
  expr: Expr = 'idle';
  private readonly head = new THREE.Group();
  private readonly canvas = document.createElement('canvas');
  private readonly tex: THREE.CanvasTexture;
  private chompT = 99;
  private bounceT = 99;
  /** The cat is built at "big" size and scaled down so it sits behind the bowl. */
  private readonly base = 0.68;

  constructor(private readonly k: Kitchen, private readonly hud: Hud, at: THREE.Vector3) {
    this.group.position.copy(at);
    const fur = new THREE.MeshStandardMaterial({ color: FUR, roughness: 0.8 });

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.058, 32, 24), fur);
    body.position.y = 0.055;
    body.scale.set(1, 0.95, 0.9);
    this.group.add(body);

    for (const s of [-1, 1]) {
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), fur);
      paw.position.set(s * 0.035, 0.016, 0.04);
      this.group.add(paw);
    }
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 10, 20, Math.PI * 0.9), fur);
    tail.position.set(0.05, 0.025, -0.03);
    tail.rotation.set(0.4, 0.6, 0);
    this.group.add(tail);

    this.head.position.y = 0.125;
    this.group.add(this.head);
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

    // The face: a canvas texture wrapped onto a patch of sphere that hugs the front of the head.
    this.canvas.width = this.canvas.height = 256;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const patch = new THREE.SphereGeometry(0.0535, 32, 24, Math.PI / 2 - 0.8, 1.6, 0.55, 1.5);
    const face = new THREE.Mesh(patch, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.05 }));
    face.position.set(0, -0.004, 0);
    face.rotation.x = -0.25;
    this.head.add(face);

    this.group.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
    k.scene.add(this.group);
    this.express('idle');
    k.updaters.add((dt, t) => this.update(dt, t));
  }

  /** World point at the side of the head, where the speech bubble points. */
  headSide() { return this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.03, 0.01, 0)); }

  /** World point the cake goes into. */
  mouth() { return this.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.015, 0.03)); }

  express(expr: Expr) {
    this.expr = expr;
    const c = this.canvas.getContext('2d')!;
    c.clearRect(0, 0, 256, 256);
    c.lineCap = 'round';
    c.lineWidth = 9;
    c.strokeStyle = '#6b4a3a';
    c.fillStyle = '#6b4a3a';
    // Blush.
    c.fillStyle = 'rgba(255,140,165,0.55)';
    for (const x of [62, 194]) { c.beginPath(); c.ellipse(x, 150, 22, 13, 0, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#6b4a3a';
    const eyes = (draw: (x: number) => void) => { draw(92); draw(164); };
    switch (expr) {
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
    c.beginPath();
    if (expr === 'meh') { c.moveTo(108, 172); c.lineTo(148, 172); }
    else if (expr === 'excited' || expr === 'love' || expr === 'yum') { c.arc(128, 160, 20, 0.15 * Math.PI, 0.85 * Math.PI); }
    else if (expr === 'ooh') { c.ellipse(128, 172, 9, 12, 0, 0, Math.PI * 2); }
    else { c.moveTo(112, 162); c.quadraticCurveTo(120, 174, 128, 164); c.quadraticCurveTo(136, 174, 144, 162); }
    c.stroke();
    if (expr === 'yum') { c.fillStyle = '#ff8fa3'; c.beginPath(); c.ellipse(128, 178, 9, 7, 0, 0, Math.PI); c.fill(); }
    this.tex.needsUpdate = true;
  }

  say(line: string, expr?: Expr) {
    if (expr) this.express(expr);
    this.hud.bubble(line);
    this.bounceT = 0;
  }

  chomp() {
    this.chompT = 0;
    this.express('yum');
  }

  private update(dt: number, t: number) {
    this.group.rotation.y = Math.sin(t * 0.7) * 0.08;
    this.head.position.y = 0.125 + Math.sin(t * 2.2) * 0.003;
    this.head.rotation.z = Math.sin(t * 1.3) * 0.05;
    this.bounceT += dt;
    this.chompT += dt;
    let s = 1;
    if (this.bounceT < 0.4) s += Math.sin((this.bounceT / 0.4) * Math.PI) * 0.12;
    if (this.chompT < 0.9) {
      const c = Math.abs(Math.sin(this.chompT * 14));
      this.head.scale.set(1 + c * 0.08, 1 - c * 0.15, 1 + c * 0.08);
    } else this.head.scale.setScalar(1);
    this.group.scale.setScalar(s * this.base);
    const p = this.k.toScreen(this.headSide());
    const offscreen = p.x < -40 || p.x > window.innerWidth + 40 || p.y < -40 || p.y > window.innerHeight + 40;
    this.hud.bubbleAt(p.x, p.y, offscreen);
  }
}

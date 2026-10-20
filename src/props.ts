// Procedural props. Everything here is simple geometry in pastel colours; any of it can be
// swapped for a kit model later without touching the Steps that use it.
import * as THREE from 'three';
import { P } from './kitchen';
import type { Flavor } from './recipes';

export type Quality = 'under' | 'right' | 'over';

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function shadowed<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}

/** Springform pan: a steel ring on a base. Children are named so Steps can find them. */
export function makePan() {
  const g = new THREE.Group();
  // Pale "steel": no environment map here, so real metalness just looks dark.
  const steel = mat(0xe3e8ee, { metalness: 0.1, roughness: 0.45 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.055, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xe3e8ee, metalness: 0.1, roughness: 0.45, side: THREE.DoubleSide }));
  ring.position.y = 0.0275;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 48), steel);
  base.position.y = 0.003;
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.02), steel);
  clip.position.set(0.088, 0.03, 0);
  g.add(ring, base, clip);

  // Parchment lining: a crinkly cone that appears once the pan is lined.
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector2(0.07 + 0.012 * (i / 8), 0.007 + 0.065 * (i / 8)));
  const lgeo = new THREE.LatheGeometry(pts, 40);
  const lp = lgeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < lp.count; i++) {
    const y = lp.getY(i);
    const a = Math.atan2(lp.getZ(i), lp.getX(i));
    const k = 1 + (y / 0.07) * 0.035 * Math.sin(a * 9 + y * 60) + (y / 0.07) * 0.02 * Math.sin(a * 4);
    lp.setX(i, lp.getX(i) * k);
    lp.setZ(i, lp.getZ(i) * k);
  }
  lgeo.computeVertexNormals();
  const lining = new THREE.Mesh(lgeo, mat(0xfbf3e4, { side: THREE.DoubleSide, roughness: 0.95 }));
  lining.name = 'lining';
  lining.visible = false;
  g.add(lining);

  // Batter fill: a disc that rises.
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 1, 40), mat(0xfcebc4, { roughness: 0.3 }));
  fill.name = 'fill';
  fill.visible = false;
  g.add(fill);
  return shadowed(g);
}

/** A flat sheet of parchment on the counter. */
export function makeParchment() {
  const geo = new THREE.PlaneGeometry(0.2, 0.2, 10, 10);
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setZ(i, (Math.random() - 0.5) * 0.004);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(P.paper, { side: THREE.DoubleSide, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  const g = new THREE.Group();
  g.add(m);
  return shadowed(g);
}

/** A cream jug: a lathe body with a lip and a handle. */
export function makeJug(color = 0xfffaf2) {
  const pts = [[0, 0], [0.035, 0], [0.04, 0.03], [0.034, 0.07], [0.038, 0.085], [0.03, 0.086], [0.028, 0.07], [0.033, 0.03], [0.0, 0.004]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), mat(color, { side: THREE.DoubleSide, roughness: 0.4 }));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 10, 24, Math.PI), mat(color, { roughness: 0.4 }));
  handle.position.set(-0.04, 0.045, 0);
  handle.rotation.z = Math.PI / 2;
  const g = new THREE.Group();
  g.add(body, handle);
  return shadowed(g);
}

/** A measuring cup of flour (or sugar). */
export function makeCup(color = 0xf6d9e0, contents = 0xfffdf7) {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.06, 32, 1, true), mat(color, { side: THREE.DoubleSide }));
  cup.position.y = 0.03;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.004, 32), mat(color));
  base.position.y = 0.002;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.01, 32), mat(contents, { roughness: 1 }));
  top.position.y = 0.052;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.012), mat(color));
  handle.position.set(0.045, 0.045, 0);
  g.add(cup, base, top, handle);
  return shadowed(g);
}

/** A little dish of blueberries. */
export function makeBerryDish() {
  const g = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.02, 32, 1, true), mat(P.glass, { side: THREE.DoubleSide }));
  dish.position.y = 0.01;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 32), mat(P.glass));
  base.position.y = 0.002;
  g.add(dish, base);
  const berry = mat(0x5a4c9e, { roughness: 0.5 });
  for (let i = 0; i < 9; i++) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), berry);
    const a = (i / 9) * Math.PI * 2;
    const r = i < 6 ? 0.022 : 0.009;
    b.position.set(Math.cos(a) * r, 0.022, Math.sin(a) * r);
    g.add(b);
  }
  return shadowed(g);
}

/** Half a lemon, cut side up. */
export function makeLemon() {
  const g = new THREE.Group();
  const half = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xf6e25b, { roughness: 0.5 }));
  half.position.y = 0.03;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), mat(0xfbf3a8));
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.031;
  const pith = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.03, 24), mat(0xfffbe0));
  pith.rotation.x = -Math.PI / 2;
  pith.position.y = 0.0315;
  g.add(half, face, pith);
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.002, 0.024), mat(0xfffbe0));
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = (i / 8) * Math.PI;
    seg.position.y = 0.032;
    g.add(seg);
  }
  return shadowed(g);
}

/** A whisk: handle plus wire loops. */
export function makeWhisk() {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 12), mat(P.pink));
  handle.position.y = 0.1;
  g.add(handle);
  const wire = mat(P.steel, { metalness: 0.7, roughness: 0.3 });
  for (let i = 0; i < 4; i++) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.0015, 6, 24), wire);
    loop.rotation.y = (i / 4) * Math.PI;
    loop.scale.set(1, 1.3, 1);
    loop.position.y = 0.03;
    g.add(loop);
  }
  return shadowed(g);
}

/** The oven: a box with a drop-down door, a window and a light inside. */
export function makeOven() {
  const g = new THREE.Group();
  const w = 0.3, h = 0.26, d = 0.3;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(0xf7f1ea, { roughness: 0.7 }));
  shell.position.set(0, h / 2, 0);
  g.add(shell);
  // Cavity: a dark box set into the front.
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, h - 0.08, d - 0.03), new THREE.MeshStandardMaterial({ color: 0x3a2e2a, roughness: 0.9, side: THREE.BackSide }));
  cavity.position.set(0, h / 2 - 0.005, 0.015);
  cavity.name = 'cavity';
  g.add(cavity);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.05, 0.008, d - 0.03), mat(0x4a3b35));
  floor.position.set(0, 0.034, 0.015);
  g.add(floor);
  // Door, hinged at the bottom front edge.
  const door = new THREE.Group();
  door.name = 'door';
  door.position.set(0, 0.03, d / 2 + 0.005);
  const panel = new THREE.Mesh(new THREE.BoxGeometry(w - 0.03, h - 0.07, 0.012), mat(0xfbf6f0, { roughness: 0.6 }));
  panel.position.y = (h - 0.07) / 2;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, h - 0.15), new THREE.MeshStandardMaterial({ color: 0x4a3a34, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.4 }));
  glass.name = 'glass';
  glass.position.set(0, (h - 0.07) / 2, 0.0065);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, w - 0.1, 12), mat(0xe3e8ee, { metalness: 0.1, roughness: 0.4 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, h - 0.085, 0.018);
  door.add(panel, glass, handle);
  g.add(door);
  // Knobs on top.
  for (let i = -1; i <= 1; i++) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 16), mat(P.pink));
    k.position.set(i * 0.05, h + 0.006, d / 2 - 0.04);
    g.add(k);
  }
  const light = new THREE.PointLight(0xffa040, 0, 0.32);
  light.name = 'light';
  light.position.set(0, h - 0.06, 0.03);
  g.add(light);
  return shadowed(g);
}

/** The fridge: a tall pastel box. */
export function makeFridge() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.8, 0.4), mat(P.glass, { roughness: 0.5 }));
  body.position.y = 0.4;
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.006, 0.004), mat(0xbfd4df));
  seam.position.set(0, 0.55, 0.2);
  const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.012), mat(P.steel, { metalness: 0.5, roughness: 0.3 }));
  h1.position.set(0.16, 0.66, 0.21);
  const h2 = h1.clone();
  h2.position.y = 0.42;
  g.add(body, seam, h1, h2);
  return shadowed(g);
}

/** The Shelf: a little raised stand on the counter the finished cakes sit on. */
export function makeShelf() {
  const g = new THREE.Group();
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.016, 0.13), mat(0xe9c7a4, { roughness: 0.9 }));
  g.add(plank);
  for (const x of [-0.22, 0.22]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.1, 0.1), mat(0xd9b48f));
    leg.position.set(x, -0.05, 0);
    g.add(leg);
  }
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.01, 0.012), mat(P.pink));
  trim.position.set(0, 0.012, 0.062);
  g.add(trim);
  return shadowed(g);
}

/** The recipe book lying open on the counter. */
export function makeBook() {
  const g = new THREE.Group();
  const cover = mat(P.pink, { roughness: 0.8 });
  const page = mat(0xfffdf6, { roughness: 1 });
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.006, 0.13), cover);
    c.position.set(s * 0.048, 0.003, 0);
    c.rotation.z = -s * 0.08;
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.008, 0.122), page);
    p.position.set(s * 0.046, 0.0095, 0);
    p.rotation.z = -s * 0.08;
    g.add(c, p);
    for (let i = 0; i < 4; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.001, 0.004), mat(0xd9b8c4));
      line.position.set(s * 0.046, 0.0145, -0.04 + i * 0.022);
      line.rotation.z = -s * 0.08;
      g.add(line);
    }
  }
  const icon = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.02, 16), mat(P.butter));
  icon.position.set(-0.046, 0.024, 0.04);
  g.add(icon);
  return shadowed(g);
}

export const FLAVOR_TINT: Record<string, number> = { classic: 0xf3e2b8, blueberry: 0xd4bfe3, lemon: 0xf7efad };
const TOP: Record<Quality, number> = { under: 0xe4bf7a, right: 0x5a3a28, over: 0x30190f };

/** A finished Basque cheesecake in its parchment collar. */
export function makeCake(flavor: Flavor['id'] | string, quality: Quality) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.068, 0.05, 48), mat(FLAVOR_TINT[flavor] ?? FLAVOR_TINT.classic, { roughness: 0.55 }));
  body.position.y = 0.025;
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat(TOP[quality], { roughness: 0.5 }));
  top.scale.set(1, 0.22, 1);
  top.position.y = 0.05;
  // Scorch is uneven: darker patches on the burnt top.
  if (quality !== 'under') {
    for (let i = 0; i < 5; i++) {
      const patch = new THREE.Mesh(new THREE.CircleGeometry(0.012 + Math.random() * 0.012, 16), mat(quality === 'over' ? 0x1c0d06 : 0x3a2114, { roughness: 0.6 }));
      patch.rotation.x = -Math.PI / 2;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 0.04;
      patch.position.set(Math.cos(a) * r, 0.0655 - r * 0.15, Math.sin(a) * r);
      g.add(patch);
    }
  }
  g.add(body, top);
  // Parchment collar.
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector2(0.074 + 0.018 * (i / 6), 0.002 + 0.07 * (i / 6)));
  const cgeo = new THREE.LatheGeometry(pts, 40);
  const cp = cgeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i);
    const a = Math.atan2(cp.getZ(i), cp.getX(i));
    const k = 1 + (y / 0.07) * 0.08 * Math.sin(a * 9 + y * 50) + (y / 0.07) * 0.04 * Math.sin(a * 4 + 1);
    cp.setX(i, cp.getX(i) * k);
    cp.setZ(i, cp.getZ(i) * k);
  }
  cgeo.computeVertexNormals();
  g.add(new THREE.Mesh(cgeo, mat(P.paper, { side: THREE.DoubleSide, roughness: 0.9 })));
  // Garnish.
  if (flavor === 'blueberry') {
    const berry = mat(0x5a4c9e, { roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), berry);
      const a = (i / 6) * Math.PI * 2 + 0.4;
      b.position.set(Math.cos(a) * 0.03, 0.068, Math.sin(a) * 0.03);
      g.add(b);
    }
  } else if (flavor === 'lemon') {
    const slice = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.004, 24), mat(0xf6e25b));
    slice.position.set(0.02, 0.068, -0.01);
    slice.rotation.z = 0.3;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.0045, 24), mat(0xfbf3a8));
    inner.position.copy(slice.position);
    inner.rotation.copy(slice.rotation);
    g.add(slice, inner);
  }
  return shadowed(g);
}

/** A generic cake for Shelf entries from other recipes. */
export function makeOtherCake(recipe: string) {
  const g = new THREE.Group();
  const color = recipe === 'tiramisu' ? 0x8b5a3c : 0xf3d9a8;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.05, 48), mat(color, { roughness: 0.6 }));
  body.position.y = 0.025;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.012, 48), mat(recipe === 'tiramisu' ? 0x5a3a28 : 0xfff6e2, { roughness: 0.8 }));
  top.position.y = 0.056;
  g.add(body, top);
  return shadowed(g);
}

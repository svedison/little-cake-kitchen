// Procedural props. Everything here is simple geometry in pastel colours; any of it can be
// swapped for a kit model later without touching the Steps that use it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { P } from './kitchen';
import type { Flavor } from './recipes';
import { DIAL, bakeLook } from './steps/bake';

export type Quality = 'under' | 'right' | 'over';

const mat = (color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...extra });

function shadowed<T extends THREE.Object3D>(o: T): T {
  // Scorch patches lie on a dome's skin, so they neither cast nor take shadows of their own.
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.name !== 'patch') { c.castShadow = true; c.receiveShadow = true; } });
  return o;
}

/**
 * The pan's numbers the pour reads. Heights are above the pan's base. The seam is the
 * "just right" fill line drawn round the parchment collar.
 */
export const PAN = {
  floorY: 0.006,
  fillR: 0.072,
  /** Fill height (above the floor) the seam marks. */
  seamLevel: 0.038,
  /** The most the pour ever fills to: well under the collar's top, so nothing overflows (ADR-0002). */
  maxLevel: 0.047,
};

/** Radius of the crinkled lining at a height and angle (the same formula its vertices are bent by). */
export function liningRadius(y: number, a: number) {
  const r = 0.068 + 0.011 * THREE.MathUtils.clamp((y - 0.007) / 0.065, 0, 1);
  return r * (1 + (y / 0.072) * 0.03 * Math.sin(a * 9 + y * 60) + (y / 0.072) * 0.015 * Math.sin(a * 4));
}

/** Height of the lining's paper floor in the pan (just over the steel base, under the fill). */
export const LINING_FLOOR_Y = 0.0063;
/** The lining's collar: it starts at the floor's edge at this radius and height and rises this far. */
export const LINING = { r0: 0.068, y0: 0.007, h: 0.065 };

/** A point on the seam (pan frame) at an angle round the collar: 1.6 mm in from the crinkled paper. */
export function seamPoint(a: number, out = new THREE.Vector3()) {
  const y = PAN.floorY + PAN.seamLevel;
  const r = liningRadius(y, a) - 0.0016;
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

/** Springform pan: a steel ring on a base. Children are named so Steps can find them. */
export function makePan() {
  const g = new THREE.Group();
  // Pale "steel": no environment map here, so real metalness just looks dark.
  const steel = mat(0xe3e8ee, { metalness: 0.1, roughness: 0.45 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.055, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xe3e8ee, metalness: 0.1, roughness: 0.45, side: THREE.DoubleSide }));
  ring.name = 'ring';
  ring.position.y = 0.0275;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 48), steel);
  base.position.y = 0.003;
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.02), steel);
  clip.position.set(0.088, 0.03, 0);
  g.add(ring, base, clip);

  // Parchment lining: a crinkly cone that appears once the pan is lined. It flares from
  // 0.068 to 0.079 and the crinkle adds at most 4.5%, so it never pokes through the 0.085 ring.
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector2(0.068 + 0.011 * (i / 8), 0.007 + 0.065 * (i / 8)));
  const lgeo = new THREE.LatheGeometry(pts, 40);
  const lp = lgeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < lp.count; i++) {
    const y = lp.getY(i);
    const a = Math.atan2(lp.getZ(i), lp.getX(i));
    const k = 1 + (y / 0.072) * 0.03 * Math.sin(a * 9 + y * 60) + (y / 0.072) * 0.015 * Math.sin(a * 4);
    lp.setX(i, lp.getX(i) * k);
    lp.setZ(i, lp.getZ(i) * k);
  }
  lgeo.computeVertexNormals();
  const lining = new THREE.Mesh(lgeo, mat(0xfbf3e4, { side: THREE.DoubleSide, roughness: 0.95 }));
  lining.name = 'lining';
  lining.visible = false;
  g.add(lining);
  // and the paper on the pan's floor, under the fill (the sheet folds into exactly this shape)
  const liningFloor = new THREE.Mesh(new THREE.CircleGeometry(0.069, 40), lining.material);
  liningFloor.rotation.x = -Math.PI / 2;
  liningFloor.position.y = LINING_FLOOR_Y;
  lining.add(liningFloor);

  // The fill line: a pink seam drawn round the inside of the collar at the "just right"
  // height, following its crinkle 1.6 mm in from the paper so it reads as printed on it.
  const seamPts: THREE.Vector3[] = [];
  for (let i = 0; i < 120; i++) seamPts.push(seamPoint((i / 120) * Math.PI * 2));
  const seam = new THREE.Mesh(
    // 1.4 mm thick: about 4 px on a phone, a line you can read at arm's length (tuned by eye)
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seamPts, true), 240, 0.0014, 5, true),
    mat(0xee8fa6, { roughness: 0.7 }),
  );
  seam.name = 'seam';
  lining.add(seam);

  // Batter fill: a disc that rises. The pour shapes its top with a soft surface and only
  // hands this plain cylinder its final height; the bake then puffs it.
  const fill = new THREE.Mesh(new THREE.CylinderGeometry(PAN.fillR, PAN.fillR, 1, 40), mat(0xfcebc4, { roughness: 0.3 }));
  fill.name = 'fill';
  fill.visible = false;
  g.add(fill);

  // A poured-too-long cake: a thicker, darker lip of batter climbing the collar. It is drawn
  // at unit height on the fill's top (the fill's y-scale is its height; the pour scales the
  // lip back to metres, and when the bake puffs the fill the lip puffs with it).
  const lipPts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    lipPts.push(new THREE.Vector2(0.056 + (PAN.fillR - 0.0003 - 0.056) * u, u * u));
  }
  lipPts.push(new THREE.Vector2(PAN.fillR - 0.0003, 0));
  const lip = new THREE.Mesh(new THREE.LatheGeometry(lipPts, 48), mat(0xe9d3a6, { roughness: 0.4, side: THREE.DoubleSide }));
  lip.name = 'fillLip';
  lip.position.y = 0.5;
  lip.visible = false;
  fill.add(lip);

  // The crown the bake puffs up on the batter: a shallow dome with the scorch patches on it.
  // Bake shows it, sits it on the fill's top and drives its rise and colour.
  const crown = new THREE.Group();
  crown.name = 'crown';
  crown.visible = false;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(PAN.fillR - 0.0004, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xfcebc4, { roughness: 0.45 }));
  dome.name = 'dome';
  dome.scale.set(1, 0.22 * 0.6, 1);
  addPatches(dome, PAN.fillR - 0.0004, 0x3a2114, 0);
  crown.add(dome);
  g.add(crown);
  return shadowed(g);
}

/**
 * Where the scorch blotches sit on a cake's dome, as [angle, radius as a fraction of the
 * dome's, size (m), stretch]: mostly out toward the rim, where a Basque top catches first.
 * None sits in the +z wedge (angles near pi/2 in the dome's frame), the bite makeCake cuts.
 */
const PATCHES: [number, number, number, number][] = [
  [0.3, 0.2, 0.013, 1.3], [2.5, 0.55, 0.012, 1.5], [3.1, 0.7, 0.01, 1.4], [3.8, 0.58, 0.013, 1.5],
  [4.5, 0.7, 0.011, 1.4], [5.2, 0.6, 0.012, 1.5], [5.9, 0.7, 0.01, 1.4], [0.6, 0.64, 0.01, 1.3],
]

/** A soft, ragged blotch (white, its alpha the shape), drawn once and shared by every scorch. */
let blotchTex: THREE.Texture | null = null;
function blotch() {
  if (blotchTex) return blotchTex;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  // A few overlapping soft lobes plus a ragged angular edge: never a clean circle.
  const lobes = [[0, 0, 0.55], [0.22, -0.12, 0.4], [-0.2, 0.15, 0.38], [0.05, 0.25, 0.3], [-0.25, -0.2, 0.28]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = (x / (n - 1)) * 2 - 1, v = (y / (n - 1)) * 2 - 1;
    const a = Math.atan2(v, u);
    const rag = 1 + 0.12 * Math.sin(a * 5 + 1.3) + 0.07 * Math.sin(a * 11 + 0.4) + 0.05 * Math.sin(a * 17);
    let k = 0;
    for (const [cx, cy, r] of lobes) {
      const d = Math.hypot(u - cx, v - cy) / (r * rag);
      k = Math.max(k, 1 - THREE.MathUtils.smoothstep(d, 0.35, 1));
    }
    // speckle so the blotch reads as crust, not paint
    k *= 0.8 + 0.2 * Math.sin(x * 1.7 + Math.sin(y * 0.9) * 3) * Math.sin(y * 1.3 + x * 0.4);
    const i = (y * n + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(THREE.MathUtils.clamp(k, 0, 1) * 255);
  }
  g.putImageData(img, 0, 0);
  blotchTex = new THREE.CanvasTexture(c);
  blotchTex.colorSpace = THREE.SRGBColorSpace;
  return blotchTex;
}

/**
 * Scorch blotches on a hemisphere dome (radius r, in its own unscaled space): soft-edged
 * ragged quads laid on its surface, so when the dome is squashed flat they flatten with it.
 * They share one transparent material that the bake darkens and fades in.
 */
function addPatches(dome: THREE.Mesh, r: number, color: number | THREE.Color, opacity: number) {
  const m = new THREE.MeshStandardMaterial({ color, map: blotch(), roughness: 0.6, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const zAxis = new THREE.Vector3(0, 0, 1);
  const spin = new THREE.Quaternion();
  for (const [a, f, size, stretch] of PATCHES) {
    const h = f * r;
    const n = new THREE.Vector3(Math.cos(a) * h, Math.sqrt(r * r - h * h), Math.sin(a) * h).normalize();
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(size * 2 * stretch, size * 2), m);
    patch.name = 'patch';
    patch.position.copy(n).multiplyScalar(r + 0.0006);
    // laid on the skin, long side running round the rim
    patch.quaternion.setFromUnitVectors(zAxis, n).multiply(spin.setFromAxisAngle(zAxis, a * 1.7 + f * 3));
    patch.visible = opacity > 0.01;
    dome.add(patch);
  }
}

/** A flat sheet of parchment on the counter. */
export function makeParchment() {
  // fine enough to fold into the pan's lining with its pleats (linepan bends its vertices)
  const geo = new THREE.PlaneGeometry(0.2, 0.2, 28, 28);
  const p = geo.attributes.position as THREE.BufferAttribute;
  // a soft, uneven ripple (fine random noise on this many vertices reads as sandpaper)
  const ph = Math.random() * 6;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    p.setZ(i, 0.0012 * Math.sin(x * 47 + ph) * Math.cos(y * 39 - ph) + 0.0008 * Math.sin((x + y) * 83 + ph * 2) + (Math.random() - 0.5) * 0.0006);
  }
  geo.computeVertexNormals();
  // A touch warmer than the lining so it reads against the pale counter (the fold lerps it to the lining's colour).
  const m = new THREE.Mesh(geo, mat(0xf3dfb8, { side: THREE.DoubleSide, roughness: 0.95 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.003;
  // A soft caramel rim just under the sheet's edge, so the sheet stands out on the counter.
  // Flat, so linepan hides it as the sheet starts to fold.
  const frame = new THREE.Shape([[-0.106, -0.106], [0.106, -0.106], [0.106, 0.106], [-0.106, 0.106]].map(([x, y]) => new THREE.Vector2(x, y)));
  frame.holes.push(new THREE.Path([[-0.0992, -0.0992], [-0.0992, 0.0992], [0.0992, 0.0992], [0.0992, -0.0992]].map(([x, y]) => new THREE.Vector2(x, y))));
  const edge = new THREE.Mesh(new THREE.ShapeGeometry(frame), mat(0xc79a62, { roughness: 0.9 }));
  edge.name = 'edge';
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.0015;
  const g = new THREE.Group();
  g.add(m, edge);
  shadowed(g);
  edge.castShadow = false;
  return g;
}

/** The point a pourable pours from, in its own space (every pourable sets userData.lip). */
export function lipOf(obj: THREE.Object3D): THREE.Vector3 {
  return (obj.userData.lip as THREE.Vector3 | undefined)?.clone() ?? new THREE.Vector3();
}

/**
 * Tell a pourable how far it is tipped (radians) and how much of it has gone (0..1), for
 * props whose contents move as they pour (the flour slides toward the lip). Others ignore it.
 */
export function setPourState(obj: THREE.Object3D, tilt: number, emptied: number) {
  (obj.userData.onPour as ((tilt: number, emptied: number) => void) | undefined)?.(tilt, emptied);
}

/** A cream jug: a lathe body with a pinched spout on +x and a handle on -x. */
export function makeJug(color = 0xfffaf2) {
  const pts = [[0, 0], [0.035, 0], [0.04, 0.03], [0.034, 0.07], [0.038, 0.085], [0.03, 0.086], [0.028, 0.07], [0.033, 0.03], [0.0, 0.004]].map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 48);
  // The spout: near angle 0 (+x) the top of the wall is pulled outward and a touch down,
  // and its sides pinched together, so it reads as a pouring lip (tuned by eye).
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 1e-6) continue;
    const a = Math.atan2(z, x);
    const w = Math.exp(-((a / 0.5) ** 2));
    const up = THREE.MathUtils.smoothstep(y, 0.055, 0.086);
    const k = w * up;
    const nr = r + 0.013 * k;
    const na = a * (1 - 0.35 * k);
    p.setXYZ(i, Math.cos(na) * nr, y - 0.004 * k, Math.sin(na) * nr);
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, mat(color, { side: THREE.DoubleSide, roughness: 0.4 }));
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.005, 10, 24, Math.PI), mat(color, { roughness: 0.4 }));
  handle.position.set(-0.04, 0.045, 0);
  handle.rotation.z = Math.PI / 2;
  const g = new THREE.Group();
  g.add(body, handle);
  g.userData.lip = new THREE.Vector3(0.049, 0.079, 0); // just inside the tip of the spout, so the stream's open end is hidden
  return shadowed(g);
}

/** A measuring cup of flour (or sugar); the handle is on -x so it pours over +x. */
export function makeCup(color = 0xf6d9e0, contents = 0xfffdf7) {
  const g = new THREE.Group();
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.028, 0.06, 32, 1, true), mat(color, { side: THREE.DoubleSide }));
  cup.position.y = 0.03;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.004, 32), mat(color));
  base.position.y = 0.002;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.01, 32), mat(contents, { roughness: 1 }));
  top.position.y = 0.052;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.012), mat(color));
  handle.position.set(-0.045, 0.045, 0);
  g.add(cup, base, top, handle);
  g.userData.lip = new THREE.Vector3(0.035, 0.06, 0);
  // The flour slides toward the lip as the cup tips and sinks and shrinks as it empties,
  // always staying inside the cup's wall (radius 0.028..0.034).
  g.userData.onPour = (tilt: number, emptied: number) => {
    const e = THREE.MathUtils.clamp(emptied, 0, 1);
    const slide = THREE.MathUtils.clamp(tilt / 1.2, 0, 1);
    const s = 1 - 0.55 * e;
    top.scale.set(s, 1 - 0.5 * e, s);
    top.position.set(0.032 * (1 - s) * slide, 0.052 - 0.018 * e, 0);
    top.visible = e < 0.98;
  };
  return shadowed(g);
}

/** Berry radius (m), shared by the dish and the pour's physics bodies. */
export const BERRY_R = 0.008;

/**
 * The dish's shape, which the pour's kinematic body copies: a floor and a low ring. A berry
 * against the ring pivots over its top once the dish is tipped past atan(R / (centre - top)),
 * ~76° with the top 2 mm under a berry's middle: it holds them until it is really tipped.
 */
export const DISH = { floorR: 0.03, floorTop: 0.004, ringR: 0.037, ringTop: 0.01 };

const berryMat = mat(0x5a4c9e, { roughness: 0.5 });

/** One blueberry (the dish's, and the extra ones the pour feeds in). */
export function makeBerry() {
  const b = new THREE.Mesh(new THREE.SphereGeometry(BERRY_R, 12, 10), berryMat);
  b.name = 'berry';
  b.castShadow = true;
  return b;
}

/** A little dish of blueberries; the berries are children named 'berry', sitting where they settle. */
export function makeBerryDish() {
  const g = new THREE.Group();
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.04, DISH.floorR, DISH.ringTop, 32, 1, true), mat(P.glass, { side: THREE.DoubleSide }));
  dish.position.y = DISH.ringTop / 2;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(DISH.floorR, DISH.floorR, DISH.floorTop, 32), mat(P.glass));
  base.position.y = DISH.floorTop / 2;
  g.add(dish, base);
  // One in the middle and six round the edge on the floor, two on top in the gaps; no two touch.
  const y0 = DISH.floorTop + BERRY_R;
  const spots: [number, number, number][] = [[0, y0, 0]];
  for (let i = 0; i < 6; i++) spots.push([Math.cos((i / 6) * Math.PI * 2) * 0.021, y0, Math.sin((i / 6) * Math.PI * 2) * 0.021]);
  for (const a of [Math.PI / 6, (Math.PI * 7) / 6]) spots.push([Math.cos(a) * 0.013, y0 + 0.013, Math.sin(a) * 0.013]);
  for (const [x, y, z] of spots) {
    const b = makeBerry();
    b.position.set(x, y, z);
    g.add(b);
  }
  g.userData.lip = new THREE.Vector3(0.04, DISH.ringTop, 0);
  return shadowed(g);
}

/**
 * Half a lemon, cut side up. Its parts sit in a child group whose origin is the cut face,
 * so setSqueeze() presses the dome toward the face while the rim (the drip point) stays put.
 */
export function makeLemon() {
  const g = new THREE.Group();
  const FACE = 0.031;
  const squash = new THREE.Group();
  squash.name = 'squash';
  squash.position.y = FACE;
  const half = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xf6e25b, { roughness: 0.5 }));
  half.position.y = 0.03 - FACE;
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.03, 24), mat(0xfbf3a8, { roughness: 0.3 }));
  face.rotation.x = -Math.PI / 2;
  const pith = new THREE.Mesh(new THREE.RingGeometry(0.025, 0.03, 24), mat(0xfffbe0));
  pith.rotation.x = -Math.PI / 2;
  pith.position.y = 0.0005;
  squash.add(half, face, pith);
  for (let i = 0; i < 8; i++) {
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(0.002, 0.024), mat(0xfffbe0));
    seg.rotation.x = -Math.PI / 2;
    seg.rotation.z = (i / 8) * Math.PI;
    seg.position.y = 0.001;
    squash.add(seg);
  }
  g.add(squash);
  // The drip point: the cut face's rim on +z, the lowest point once the half is tipped
  // toward the camera about x.
  g.userData.lip = new THREE.Vector3(0, FACE, 0.028);
  return shadowed(g);
}

/**
 * Squeeze a lemon half: s is its scale along its own axis (1 relaxed, 0.72 pressed flat).
 * It bulges a little sideways, along x only, so the drip point on +z never moves.
 */
export function setSqueeze(obj: THREE.Object3D, s: number) {
  obj.getObjectByName('squash')?.scale.set(1 + 0.35 * (1 - s), s, 1);
}

/** The lemon's squeeze right now (1 = relaxed), for checks. */
export function squeezeOf(obj: THREE.Object3D) {
  return obj.getObjectByName('squash')?.scale.y ?? 1;
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

/**
 * The oven's measurements: the knob strip is under the door, the opening above it. 34 cm wide
 * round a 28 cm opening, so the 18 cm springform (clip included) clears it by 5 cm a side.
 */
const OVEN = {
  w: 0.34, h: 0.21, d: 0.3,
  /** Wall and front frame thickness. */
  t: 0.012,
  /** Height of the knob strip under the door; the opening starts here. */
  strip: 0.066,
  /** The opening's top and half width. */
  top: 0.195,
  halfW: 0.14,
  /** Top of the wire rack: the pan's fill top then sits at the glass's vertical centre. */
  rackY: 0.075,
};

/**
 * The oven: a shell of five panels and a front frame around a real opening, so the cavity,
 * the wire rack and whatever is on it show through the door's glass. Two heating elements
 * under the ceiling and a short-reach light inside glow with the heat; the light never
 * reaches the counter. A knob strip runs under the door and a thermometer on top shows how
 * hot it is (the HUD's bake gauge alone shows the stages and the goal).
 */
export function makeOven() {
  const g = new THREE.Group();
  const { w, h, d, t, strip, top, halfW, rackY } = OVEN;
  const shellMat = mat(0xf7f1ea, { roughness: 0.7 });
  // Panels sharing a material are merged into one mesh: the oven is ~10 draws, not ~40.
  const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const part = (m: THREE.Material, geo: THREE.BufferGeometry) => {
    if (!parts.has(m)) parts.set(m, []);
    parts.get(m)!.push(geo);
  };
  const panel = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material = shellMat) =>
    part(m, new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z));
  // Shell: floor, ceiling, two sides and the back.
  panel(w, t, d, 0, t / 2, 0);
  panel(w, t, d, 0, h - t / 2, 0);
  panel(t, h - 2 * t, d, -w / 2 + t / 2, h / 2, 0);
  panel(t, h - 2 * t, d, w / 2 - t / 2, h / 2, 0);
  panel(w - 2 * t, h - 2 * t, t, 0, h / 2, -d / 2 + t / 2);
  // Front frame: four bars round the opening (the bottom one is the knob strip).
  const fz = d / 2 - t / 2;
  panel(w, strip, t, 0, strip / 2, fz);
  panel(w, h - top, t, 0, (h + top) / 2, fz);
  panel(w / 2 - halfW, top - strip, t, -(w / 2 + halfW) / 2, (top + strip) / 2, fz);
  panel(w / 2 - halfW, top - strip, t, (w / 2 + halfW) / 2, (top + strip) / 2, fz);

  // The cavity's lining: a matte warm brown box seen from inside (its front face is culled
  // from the front, so the opening stays open). It casts no shadow of its own.
  const inner = new THREE.Vector3(w - 2 * t - 0.002, h - 2 * t - 0.002, d - 2 * t);
  const cavity = new THREE.Mesh(new THREE.BoxGeometry(inner.x, inner.y, inner.z), new THREE.MeshStandardMaterial({ color: 0x6e5247, roughness: 0.95, side: THREE.BackSide }));
  cavity.name = 'cavity';
  cavity.position.set(0, h / 2, 0);
  g.add(cavity);

  // Wire rack: two rails along the walls and four cross wires.
  const wire = mat(P.steel, { metalness: 0.4, roughness: 0.35 });
  const ry = rackY - 0.002;
  for (const s of [-1, 1]) panel(0.004, 0.004, inner.z - 0.02, s * (inner.x / 2 - 0.006), ry, 0, wire);
  for (let i = 0; i < 4; i++) panel(inner.x - 0.012, 0.003, 0.003, 0, ry, -0.1 + i * 0.07, wire);

  // Two U-shaped heating elements under the ceiling, plugged into the back wall.
  const eMat = new THREE.MeshStandardMaterial({ color: 0x5a4a44, roughness: 0.5, emissive: 0xff5a1e, emissiveIntensity: 0 });
  const ey = h - t - 0.008;
  for (const s of [-1, 1]) {
    const x0 = s * 0.03, x1 = s * 0.11, xm = (x0 + x1) / 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x0, ey, -d / 2 + t), new THREE.Vector3(x0, ey, 0.06), new THREE.Vector3(xm - s * 0.02, ey, 0.1),
      new THREE.Vector3(xm + s * 0.02, ey, 0.1), new THREE.Vector3(x1, ey, 0.06), new THREE.Vector3(x1, ey, -d / 2 + t),
    ], false, 'centripetal');
    part(eMat, new THREE.TubeGeometry(curve, 48, 0.003, 6, false));
  }
  for (const [m, list] of parts) {
    const mesh = new THREE.Mesh(mergeGeometries(list), m);
    if (m === eMat) mesh.name = 'element';
    g.add(mesh);
  }
  // A warm light inside that only reaches about the cavity (14 cm), so the counter never glows.
  const light = new THREE.PointLight(0xffa040, 0, 0.14, 2);
  light.name = 'light';
  light.position.set(0, h - t - 0.012, -0.03); // up by the elements and back, so the top gets an even glow, not a hot spot
  g.add(light);

  // Door, hinged at the bottom of the opening: four frame bars round a pane of warm glass.
  const door = new THREE.Group();
  door.name = 'door';
  door.position.set(0, strip, d / 2 + t / 2);
  const dw = 2 * halfW + 0.01, dh = top - strip + 0.007;
  const doorMat = mat(0xfbf6f0, { roughness: 0.6 });
  // A slim head bar keeps the glass tall: from above, the cake's top shows near its upper edge.
  const side = 0.022, bottom = 0.02, head = 0.012;
  const bar = (sx: number, sy: number, x: number, y: number) => new THREE.BoxGeometry(sx, sy, t).translate(x, y, 0);
  door.add(new THREE.Mesh(mergeGeometries([
    bar(dw, bottom, 0, bottom / 2),
    bar(dw, head, 0, dh - head / 2),
    bar(side, dh - bottom - head, -dw / 2 + side / 2, bottom + (dh - bottom - head) / 2),
    bar(side, dh - bottom - head, dw / 2 - side / 2, bottom + (dh - bottom - head) / 2),
  ]), doorMat));
  // Two panes. The outer one faces the room: a faint warm tint with two highlight streaks, so
  // the cake reads as behind glass yet its top colour still shows true. The inner one faces the
  // cavity and is culled from the front; once the door lies open it is what the camera sees, a
  // smoky enamel-dark pane the pan sits on, and the knob strip under it no longer shows through.
  const gw = dw - 2 * side, gh = dh - bottom - head;
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gh),
    new THREE.MeshStandardMaterial({ map: glassTex(), transparent: true, roughness: 0.08, depthWrite: false }),
  );
  glass.name = 'glass';
  glass.position.set(0, bottom + gh / 2, t / 2 - 0.002);
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gh).rotateY(Math.PI),
    new THREE.MeshStandardMaterial({ color: 0x4a3a35, transparent: true, opacity: 0.88, roughness: 0.15, depthWrite: false }),
  );
  pane.position.set(0, bottom + gh / 2, -t / 2 + 0.001);
  door.add(pane);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, dw - 0.1, 12), mat(0xe3e8ee, { metalness: 0.1, roughness: 0.4 }));
  handle.rotation.z = Math.PI / 2;
  handle.position.set(0, dh + 0.003, 0.014); // rides just above the door, over the top frame bar
  door.add(glass, handle);
  g.add(door);

  // The knob strip: three pink knobs (the right one, 'knob', turns with the bake) and a
  // little lamp that lights while the oven is held.
  const kz = d / 2 + t / 2;
  [-0.13, -0.095, -0.06].forEach((x, i) => {
    const knob = new THREE.Group();
    knob.position.set(x, strip / 2, kz);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.012, 20), mat(P.pink, { roughness: 0.5 }));
    cap.rotation.x = Math.PI / 2;
    cap.position.z = 0.006;
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.009, 0.002), mat(0xfffaf2));
    notch.position.set(0, 0.005, 0.0125);
    knob.add(cap, notch);
    if (i === 2) knob.name = 'knob';
    g.add(knob);
  });
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), new THREE.MeshStandardMaterial({ color: 0xffb37a, emissive: 0xff7a30, emissiveIntensity: 0 }));
  lamp.name = 'lamp';
  lamp.position.set(-0.014, strip / 2, kz + 0.002);
  g.add(lamp);

  const dial = makeDial();
  dial.position.set(0, h, d / 2 - 0.035);
  g.add(dial);
  g.userData.rackY = rackY;
  shadowed(g);
  cavity.castShadow = false;
  glass.castShadow = false;
  pane.castShadow = false;
  return g;
}

/** The door's outer pane: a faint warm tint and two soft diagonal highlight streaks, drawn once. */
let glassTexture: THREE.CanvasTexture | null = null;
function glassTex() {
  if (glassTexture) return glassTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = 'rgba(255,236,214,0.16)';
  x.fillRect(0, 0, 128, 128);
  // The streaks cross the top-left corner, clear of the middle where the cake's top shows.
  x.translate(30, 34);
  x.rotate(-Math.PI / 4);
  for (const [off, wd, a] of [[0, 9, 0.42], [17, 4, 0.3]]) {
    const g = x.createLinearGradient(0, off - wd, 0, off + wd);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(-90, off - wd, 180, wd * 2);
  }
  glassTexture = new THREE.CanvasTexture(c);
  glassTexture.colorSpace = THREE.SRGBColorSpace;
  return glassTexture;
}

/** A colour as a CSS string, for the canvases. */
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/**
 * The thermometer on the oven's top: a cream face with a warm band from cool cream to hot red,
 * ticks, a little flame at the hot end, and a cocoa pointer, named 'pointer', that bake.ts
 * turns with the oven's heat. It shows how hot the oven is, never the stage: the HUD's bake
 * gauge is the bake's one judge, so nothing here marks the stages or the goal.
 */
function makeDial() {
  const g = new THREE.Group();
  g.name = 'dial';
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const R = 60;
  x.fillStyle = '#fff6e9';
  x.beginPath(); x.arc(64, 64, R, 0, Math.PI * 2); x.fill();
  x.lineWidth = 6; x.strokeStyle = css(P.pink);
  x.beginPath(); x.arc(64, 64, R - 3, 0, Math.PI * 2); x.stroke();
  // Canvas angles run clockwise (y is down), so a dial angle a is canvas angle -a.
  const at = (p: number) => -(DIAL.start - DIAL.sweep * p);
  // The warm band: 24 short arcs from cream to tomato red.
  const cool = new THREE.Color(0xf3e3c4), hot = new THREE.Color(0xe8553f), col = new THREE.Color();
  const n = 24;
  x.lineWidth = 9;
  for (let i = 0; i < n; i++) {
    x.strokeStyle = `#${col.copy(cool).lerp(hot, i / (n - 1)).getHexString()}`;
    x.beginPath(); x.arc(64, 64, R - 13, at(i / n), at((i + 1) / n) + 0.01); x.stroke();
  }
  x.strokeStyle = css(P.cocoa); x.lineWidth = 2.5;
  for (let i = 0; i <= 6; i++) {
    const a = at(i / 6);
    x.beginPath(); x.moveTo(64 + Math.cos(a) * (R - 20), 64 + Math.sin(a) * (R - 20)); x.lineTo(64 + Math.cos(a) * (R - 8), 64 + Math.sin(a) * (R - 8)); x.stroke();
  }
  flame(x, 64 + Math.cos(at(1)) * 30, 64 + Math.sin(at(1)) * 30 - 6, 7);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const r = 0.032;
  // The face stands on a little foot, leaned back toward the camera.
  const face = new THREE.Group();
  face.position.set(0, 0.006 + r, 0);
  face.rotation.x = -0.35;
  const back = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.008, 32), mat(0xfbf6f0, { roughness: 0.6 }));
  back.rotation.x = Math.PI / 2;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
  disc.position.z = 0.0041;
  const pointer = new THREE.Group();
  pointer.name = 'pointer';
  pointer.position.z = 0.005;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(r * 0.8, 0.004, 0.002), mat(P.cocoa));
  needle.position.x = r * 0.4;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.003, 16), mat(P.cocoa));
  hub.rotation.x = Math.PI / 2;
  pointer.add(needle, hub);
  pointer.rotation.z = DIAL.start;
  face.add(back, disc, pointer);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.016), mat(0xfbf6f0));
  foot.position.y = 0.004;
  g.add(foot, face);
  return g;
}

/** A little flame, centred at (cx, cy): a red drop with a yellow heart. */
function flame(x: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  for (const [k, color] of [[1, '#e8553f'], [0.55, '#ffc94d']] as const) {
    const r = s * k;
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(cx, cy - r * 1.6);
    x.bezierCurveTo(cx + r * 1.1, cy - r * 0.4, cx + r, cy + r, cx, cy + r);
    x.bezierCurveTo(cx - r, cy + r, cx - r * 1.1, cy - r * 0.4, cx, cy - r * 1.6);
    x.fill();
  }
}

/**
 * The hob beside the oven: a cream two-ring cooktop with a pink pot on one ring and a little
 * moka pot on the other, so the Stove reads as a stove. Set dressing only, no physics.
 */
export function makeHob() {
  const g = new THREE.Group();
  // The hob itself (top, rings, knobs) is one group standing on the counter, so it can be
  // knocked down and built back up from its base as one thing (smash.ts).
  const hob = new THREE.Group();
  hob.name = 'hobBase';
  g.add(hob);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.22), mat(0xf7f1ea, { roughness: 0.5 }));
  top.position.y = 0.01;
  hob.add(top);
  const ringMat = mat(0x5a4a44, { roughness: 0.4 });
  const ringGeo = new THREE.TorusGeometry(0.045, 0.006, 8, 32).rotateX(Math.PI / 2);
  for (const x of [-0.07, 0.075]) {
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(x, 0.021, 0);
    hob.add(ring);
  }
  // Two knobs on the front lip.
  for (const x of [-0.07, 0.075]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 16).rotateX(Math.PI / 2), mat(P.pink));
    knob.position.set(x, 0.01, 0.112);
    hob.add(knob);
  }
  // The pot: rounded pink body, a cream rim, a lid with a butter knob and two little handles.
  const potMat = mat(P.pink, { roughness: 0.45 });
  const prof = [[0, 0], [0.05, 0], [0.056, 0.006], [0.058, 0.02], [0.058, 0.07], [0.054, 0.072], [0.052, 0.07]];
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 32), potMat);
  pot.name = 'pot';
  pot.position.set(-0.07, 0.022, 0);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.056, 32, 8, 0, Math.PI * 2, 0, Math.PI * 0.32), mat(0xfff6e9, { roughness: 0.4 }));
  lid.scale.y = 0.6;
  lid.position.y = 0.062;
  const lidKnob = new THREE.Mesh(new THREE.SphereGeometry(0.01, 16, 10), mat(P.butter));
  lidKnob.position.y = 0.093;
  pot.add(lid, lidKnob);
  for (const sx of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.004, 8, 16, Math.PI), potMat);
    h.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    h.position.set(sx * 0.058, 0.055, 0);
    pot.add(h);
  }
  g.add(pot);
  // The moka pot: an eight-sided steel waist, a peaked lid and a cocoa handle.
  const steel = mat(P.steel, { metalness: 0.5, roughness: 0.3 });
  const moka = new THREE.Group();
  moka.name = 'moka';
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.045, 8), steel);
  base.position.y = 0.0225;
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.045, 8), steel);
  upper.position.y = 0.0675;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.029, 0.018, 8), steel);
  cap.position.y = 0.099;
  const capKnob = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), mat(P.cocoa));
  capKnob.position.y = 0.11;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.045, 0.01), mat(P.cocoa));
  handle.position.set(-0.034, 0.068, 0);
  handle.rotation.z = 0.15;
  moka.add(base, upper, cap, capKnob, handle);
  moka.position.set(0.075, 0.022, 0);
  moka.rotation.y = 0.5;
  g.add(moka);
  // Only the pot and the moka pot cast shadows: the flat parts would only add shadow draws.
  g.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.receiveShadow = true; });
  for (const o of [pot, moka]) o.traverse((c) => { if ((c as THREE.Mesh).isMesh) c.castShadow = true; });
  return g;
}

/**
 * A matcha crock of kitchen tools at the back of the Counter: a wooden spoon, a pink spatula
 * and a whisk standing up out of it. Origin on the counter.
 */
export function makeCrock() {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.036, 0], [0.04, 0.006], [0.042, 0.03], [0.04, 0.075], [0.043, 0.08], [0.04, 0.081]];
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 28), mat(P.matcha, { roughness: 0.45 }));
  g.add(body);
  const wood = mat(0xd9a46c, { roughness: 0.7 });
  const spoon = new THREE.Group();
  const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.004, 0.15, 8), wood);
  sh.position.y = 0.075;
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 8), wood);
  bowl.scale.set(1, 1.4, 0.45);
  bowl.position.y = 0.155;
  spoon.add(sh, bowl);
  spoon.position.set(-0.012, 0.02, 0.006);
  spoon.rotation.z = 0.22;
  const spat = new THREE.Group();
  const sh2 = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.13, 8), mat(0xffffff, { roughness: 0.5 }));
  sh2.position.y = 0.065;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.005), mat(P.pink, { roughness: 0.5 }));
  blade.position.y = 0.145;
  spat.add(sh2, blade);
  spat.position.set(0.012, 0.02, -0.004);
  spat.rotation.z = -0.25;
  const wh = new THREE.Group();
  const sh3 = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.09, 8), mat(P.cocoa));
  sh3.position.y = 0.06;
  wh.add(sh3);
  const wire = mat(P.steel, { metalness: 0.5, roughness: 0.3 });
  for (let i = 0; i < 3; i++) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.014, 0.0012, 4, 16), wire);
    loop.scale.set(1, 1.7, 1);
    loop.rotation.y = (i / 3) * Math.PI;
    loop.position.y = 0.128;
    wh.add(loop);
  }
  wh.position.set(0.002, 0.02, -0.014);
  wh.rotation.x = -0.18;
  g.add(spoon, spat, wh);
  return shadowed(g);
}

/** A little potted basil: a terracotta pot and a round bush of leaves. Origin on the counter. */
export function makePlant() {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.028, 0], [0.036, 0.055], [0.04, 0.056], [0.04, 0.066], [0.0365, 0.066]];
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24), mat(0xd98a62, { roughness: 0.8 }));
  g.add(pot);
  const soil = new THREE.Mesh(new THREE.CircleGeometry(0.036, 20).rotateX(-Math.PI / 2), mat(0x6b4a3a, { roughness: 1 }));
  soil.position.y = 0.062;
  g.add(soil);
  const leaf = mat(0x8cc46e, { roughness: 0.6 });
  const dark = mat(0x6faa55, { roughness: 0.6 });
  const spots = [[0, 0.1, 0, 0.032], [-0.025, 0.088, 0.01, 0.022], [0.026, 0.09, -0.004, 0.024], [0.008, 0.125, -0.006, 0.022], [-0.012, 0.112, 0.018, 0.018], [0.015, 0.108, 0.02, 0.017]];
  spots.forEach(([x, y, z, r], i) => {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? dark : leaf);
    b.position.set(x, y, z);
    g.add(b);
  });
  return shadowed(g);
}

/** The fridge's size: a squat under-counter fridge that stands against the wall behind the Shelf, fully in a phone's view. */
export const FRIDGE = { w: 0.44, h: 0.36, d: 0.26 };

/** The fridge: a pastel box with a freezer seam, lit handles, magnets and a little paper heart. */
export function makeFridge() {
  const g = new THREE.Group();
  const { w, h, d } = FRIDGE;
  // A pale mint with a little glow of its own, so it reads pastel rather than grey in the Shelf's shade.
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(0xd3efe6, { roughness: 0.5, emissive: 0xd3efe6, emissiveIntensity: 0.3 }));
  body.position.y = h / 2;
  g.add(body);
  // Freezer above, fridge below: a shallow groove across the front and a thin one up the hinge side.
  const groove = mat(0xa9cfc2);
  const seamY = h * 0.68;
  const seam = new THREE.Mesh(new THREE.BoxGeometry(w, 0.006, 0.004), groove);
  seam.position.set(0, seamY, d / 2);
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.004, h - 0.02, 0.004), groove);
  hinge.position.set(-w / 2 + 0.012, h / 2, d / 2);
  g.add(seam, hinge);
  for (const [y, len] of [[seamY + 0.045, 0.05], [seamY - 0.08, 0.09]]) {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.012, len, 0.012), mat(P.steel, { metalness: 0.5, roughness: 0.3 }));
    handle.position.set(w / 2 - 0.04, y, d / 2 + 0.01);
    // A pale strip down the lit edge of each handle reads as a highlight without an environment map.
    const shine = new THREE.Mesh(new THREE.BoxGeometry(0.004, len - 0.02, 0.002), mat(0xffffff, { roughness: 0.2 }));
    shine.position.set(-0.004, 0, 0.0065);
    handle.add(shine);
    g.add(handle);
  }
  // Magnets up on the freezer door (the Shelf hides the lower door): a pink blob, a butter dot, a matcha dot.
  const dots: [number, number, number][] = [[P.pink, -0.13, 0.018], [P.butter, -0.07, 0.013], [P.matcha, 0.0, 0.015]];
  for (const [c, x, r] of dots) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), mat(c, { roughness: 0.5 }));
    m.scale.set(1, 0.9, 0.35);
    m.position.set(x, seamY + 0.045 + (x === -0.07 ? 0.02 : 0), d / 2 + 0.004);
    g.add(m);
  }
  // A paper heart held up by the pink magnet: a drawing taped to the fridge.
  const heart = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.06), new THREE.MeshStandardMaterial({ map: heartTexture(), transparent: true, roughness: 0.9 }));
  heart.position.set(0.07, seamY - 0.065, d / 2 + 0.002);
  heart.rotation.z = -0.12;
  g.add(heart);
  return shadowed(g);
}

let heartTex: THREE.CanvasTexture | null = null;
function heartTexture() {
  if (heartTex) return heartTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fffdf6';
  x.beginPath();
  x.roundRect(6, 6, 116, 116, 10);
  x.fill();
  x.fillStyle = '#ff8fa3';
  x.beginPath();
  x.moveTo(64, 100);
  x.bezierCurveTo(10, 66, 26, 22, 64, 46);
  x.bezierCurveTo(102, 22, 118, 66, 64, 100);
  x.fill();
  heartTex = new THREE.CanvasTexture(c);
  heartTex.colorSpace = THREE.SRGBColorSpace;
  return heartTex;
}

/**
 * What is left once the cat has eaten: a plate with crumbs and a fork, and the cat's verdict
 * stamped on a card propped on it, so the counter shows how it went.
 */
export function makePlate(flavor: string, label: string, color: string) {
  const g = new THREE.Group();
  const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.06, 0), new THREE.Vector2(0.075, 0.004), new THREE.Vector2(0.092, 0.012), new THREE.Vector2(0.094, 0.014), new THREE.Vector2(0.09, 0.0145), new THREE.Vector2(0.073, 0.007), new THREE.Vector2(0, 0.006)];
  const plate = new THREE.Mesh(new THREE.LatheGeometry(pts, 48), mat(0xfffdf8, { roughness: 0.35, side: THREE.DoubleSide }));
  g.add(plate);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.086, 0.0025, 8, 48), mat(P.pink, { roughness: 0.5 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.0115;
  g.add(rim);
  // Crumbs: a handful of little lumps of the cake's crumb colour, and a berry or two for blueberry.
  const crumb = mat(FLAVOR_TINT[flavor] ?? FLAVOR_TINT.classic, { roughness: 0.8 });
  const crust = mat(0xb9773f, { roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + 0.3, r = 0.02 + (i % 3) * 0.016;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.004 + (i % 2) * 0.002, 0), i % 3 === 0 ? crust : crumb);
    m.position.set(Math.cos(a) * r, 0.008, Math.sin(a) * r * 0.8 + 0.02);
    m.rotation.set(i, i * 2, 0);
    g.add(m);
  }
  if (flavor === 'blueberry') {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 10), mat(0x5a4c9e, { roughness: 0.5 }));
    b.position.set(0.04, 0.012, 0.035);
    g.add(b);
  }
  const fork = new THREE.Group();
  const steel = mat(P.steel, { metalness: 0.5, roughness: 0.3 });
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.003, 0.07), steel);
  handle.position.z = 0.035;
  fork.add(handle);
  for (const x of [-0.005, 0, 0.005]) {
    const tine = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.002, 0.022), steel);
    tine.position.set(x, 0, -0.011);
    fork.add(tine);
  }
  fork.position.set(0.055, 0.011, 0.0);
  fork.rotation.y = 0.5;
  g.add(fork);
  // The stamp: the Shelf's verdict card at four times the size, propped up facing the camera.
  const tag = makeVerdictTag(label, color, 1 / 4);
  tag.name = 'stamp';
  tag.rotation.x = -0.8;
  tag.position.set(-0.01, 0.028, -0.025);
  g.add(tag);
  return shadowed(g);
}

/** The Shelf's measurements, shared with Game, which places the cakes on it. */
export const SHELF = {
  width: 0.46,
  depth: 0.18,
  /** Height of the plank's top above the counter. */
  height: 0.07,
  /** Height of the back row's riser above the plank. */
  riser: 0.03,
  /** Where each row stands, relative to the plank's centre. */
  frontZ: 0.03,
  backZ: -0.045,
  /** Cakes per row, their scale and spacing: six 6 cm cakes with a finger's width between them. */
  perRow: 6,
  cakeScale: 0.33,
  spacing: 0.072,
};

/** The Shelf: a low stand on the counter with a riser at the back, so two rows of cakes both show. */
export function makeShelf() {
  const g = new THREE.Group();
  const plank = new THREE.Mesh(new THREE.BoxGeometry(SHELF.width, 0.016, SHELF.depth), mat(0xe9c7a4, { roughness: 0.9 }));
  g.add(plank);
  for (const x of [-0.2, 0.2]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.018, SHELF.height - 0.008, 0.1), mat(0xd9b48f));
    leg.position.set(x, -0.008 - (SHELF.height - 0.008) / 2, 0); // from under the plank down to the counter
    g.add(leg);
  }
  const riser = new THREE.Mesh(new THREE.BoxGeometry(SHELF.width - 0.02, SHELF.riser, 0.07), mat(0xe3bd97, { roughness: 0.9 }));
  riser.position.set(0, 0.008 + SHELF.riser / 2, SHELF.backZ);
  g.add(riser);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(SHELF.width, 0.01, 0.012), mat(P.pink));
  trim.position.set(0, 0.012, SHELF.depth / 2 - 0.006);
  g.add(trim);
  return shadowed(g);
}

const tagTextures = new Map<string, THREE.CanvasTexture>();

/** A little card with the cat's verdict, leaning on the front of a Shelf cake (world size 0.03 x 0.012). */
export function makeVerdictTag(label: string, color: string, cakeScale: number) {
  let tex = tagTextures.get(label + color);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fffdf6';
    g.beginPath();
    g.roundRect(2, 2, 156, 60, 14);
    g.fill();
    g.fillStyle = color;
    g.beginPath();
    g.roundRect(8, 8, 144, 48, 10);
    g.fill();
    g.fillStyle = '#6b4a3a';
    g.font = '600 30px Fredoka, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, 80, 34);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tagTextures.set(label + color, tex);
  }
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.012), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide, alphaTest: 0.5 }));
  tag.name = 'tag';
  // Built in world units: the cake it leans on is scaled down, so the tag scales back up.
  tag.scale.setScalar(1 / cakeScale);
  return tag;
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
/** Where in the bake each Result's cake stands: golden, burnt, charred (see BAKE). */
const BAKED_AT: Record<Quality, number> = { under: 0.5, right: 0.72, over: 0.93 };

/** The wedge the cat's first bite takes out of a cake, centred on the cake's +z (radians). */
export const BITE_WEDGE = (70 * Math.PI) / 180;
/** The custard a bite shows: paler and creamier than the outside, a touch glossy. */
const CUSTARD: Record<string, number> = { classic: 0xfff1c9, blueberry: 0xeedcf0, lemon: 0xfff7c2 };

/**
 * A finished Basque cheesecake in its parchment, peeled down to show the pale sides. Its top
 * is the bake's look at the Result's stage, or exactly `top` when the cake has just come out
 * of a real bake. The cake is built in two pieces: the main cake ('top' is its dome) and a
 * 'wedge' at +z, which the cat's first bite hides to show the 'cut' faces of custard inside.
 */
export function makeCake(flavor: Flavor['id'] | string, quality: Quality, top?: THREE.ColorRepresentation) {
  const g = new THREE.Group();
  const look = bakeLook(BAKED_AT[quality] ?? BAKED_AT.right);
  const w = BITE_WEDGE;
  // A burnt top is glossy caramel; a charred one dries matte.
  const domeMat = mat(new THREE.Color(top ?? look.top).getHex(), { roughness: quality === 'over' ? 0.75 : 0.35 });
  const sideMat = mat(FLAVOR_TINT[flavor] ?? FLAVOR_TINT.classic, { roughness: 0.55 });
  const wedge = new THREE.Group();
  wedge.name = 'wedge';
  // Cylinder and lathe angles run from +z toward +x; the sphere's run from -x toward +z.
  const piece = (start: number, len: number, parent: THREE.Object3D, patches: boolean) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.068, 0.05, 48, 1, false, start, len), sideMat);
    body.position.y = 0.025;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.07, 48, 12, start + Math.PI / 2, len, 0, Math.PI / 2), domeMat);
    dome.scale.set(1, 0.22 * look.puff, 1);
    dome.position.y = 0.05;
    if (patches) addPatches(dome, 0.07, look.patch, look.patchOpacity);
    parent.add(body, dome);
    return dome;
  };
  const main = piece(w / 2, Math.PI * 2 - w, g, true);
  main.name = 'top';
  piece(-w / 2, w, wedge, false);
  g.add(wedge);
  // The cut faces, hidden until the bite: the custard body and the dome's crust-lidded section.
  const custard = mat(CUSTARD[flavor] ?? CUSTARD.classic, { roughness: 0.35, side: THREE.DoubleSide });
  const cut = new THREE.Group();
  cut.name = 'cut';
  cut.visible = false;
  for (const a of [-w / 2, w / 2]) {
    // a vertical face from the axis out along (sin a, cos a): rotating y by a - pi/2 lays +x there
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.069, 0.05), custard);
    face.rotation.y = a - Math.PI / 2;
    face.position.set(Math.sin(a) * 0.0345, 0.025, Math.cos(a) * 0.0345);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.0695, 16, 0, Math.PI / 2), custard);
    cap.rotation.y = a - Math.PI / 2;
    cap.scale.y = 0.22 * look.puff;
    cap.position.y = 0.05;
    cut.add(face, cap);
  }
  g.add(cut);
  // Parchment, peeled down to under half the cake's height, its torn top edge flared out.
  const collar = (start: number, len: number, parent: THREE.Object3D) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 6; i++) pts.push(new THREE.Vector2(0.0715 + 0.016 * (i / 6) ** 2, 0.001 + 0.024 * (i / 6)));
    const cgeo = new THREE.LatheGeometry(pts, Math.max(4, Math.round(40 * len / (Math.PI * 2))), start, len);
    const cp = cgeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const y = cp.getY(i);
      const a = Math.atan2(cp.getX(i), cp.getZ(i));
      const k = 1 + (y / 0.025) * (0.05 * Math.sin(a * 9) + 0.03 * Math.sin(a * 4 + 1));
      cp.setX(i, cp.getX(i) * k);
      cp.setZ(i, cp.getZ(i) * k);
      cp.setY(i, y + (y / 0.025) * 0.004 * Math.sin(a * 7 + 0.5));
    }
    cgeo.computeVertexNormals();
    parent.add(new THREE.Mesh(cgeo, paper));
  };
  const paper = mat(P.paper, { side: THREE.DoubleSide, roughness: 0.9 });
  collar(w / 2, Math.PI * 2 - w, g);
  collar(-w / 2, w, wedge);
  // Garnish.
  if (flavor === 'blueberry') {
    const berry = mat(0x5a4c9e, { roughness: 0.5 });
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), berry);
      const a = (i / 6) * Math.PI * 2 + 0.4;
      b.position.set(Math.cos(a) * 0.03, 0.068, Math.sin(a) * 0.03);
      // a berry on the bitten wedge goes with it
      (Math.abs(a - Math.PI / 2) < w / 2 ? wedge : g).add(b);
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

/** A pink sugar canister with a wooden lid, for the counter beside the oven. Origin on the counter. */
export function makeCanister() {
  const g = new THREE.Group();
  const prof = [[0, 0], [0.027, 0], [0.03, 0.005], [0.03, 0.062], [0.027, 0.066]];
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 24), mat(P.pink, { roughness: 0.4 }));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.008, 24), mat(0xd9a46c, { roughness: 0.7 }));
  lid.position.y = 0.069;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), mat(0xd9a46c, { roughness: 0.7 }));
  knob.position.y = 0.077;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0305, 0.0305, 0.012, 24, 1, true), mat(0xffffff, { roughness: 0.5 }));
  band.position.y = 0.032;
  g.add(body, lid, knob, band);
  return shadowed(g);
}

/** A quilted oven mitt lying flat, thumb out, for the counter beside the oven. Origin on the counter. */
export function makeMitt() {
  const g = new THREE.Group();
  const cloth = mat(P.matcha, { roughness: 0.9 });
  const hand = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), cloth);
  hand.scale.set(0.032, 0.011, 0.045);
  hand.position.set(0, 0.011, -0.012);
  const thumb = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), cloth);
  thumb.scale.set(0.012, 0.009, 0.022);
  thumb.position.set(0.031, 0.009, 0.0);
  thumb.rotation.y = 0.6;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20).rotateX(Math.PI / 2), mat(0xfff4ea, { roughness: 0.9 }));
  cuff.scale.y = 0.4;
  cuff.position.set(0, 0.01, 0.034);
  g.add(hand, thumb, cuff);
  return shadowed(g);
}

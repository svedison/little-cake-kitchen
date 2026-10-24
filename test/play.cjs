// Plays a whole Basque cheesecake headlessly against dist/: book -> 6 steps -> reveal ->
// feed the cat -> shelf -> reload. Screenshots every stage and checks what it can see:
// the meter ring is really drawn, every target the game advertises is on screen, the
// cat's bubble never covers the step title and its hat is never cut off, nothing shares a
// slot (props that overlap each other, the HUD or the viewport edge are PROBLEMS unless
// the ALLOWED list below says why that pair belongs together), the pan is gone while the
// eggs and the pourables use the front slot, and only one pourable is ever out.
//
// Between Steps the flow is staged (react, leave, move, arrive): shots 150 ms after each done()
// still show the finished Step's main prop, the header only changes once the view is there and
// always pops in, and the hand-feel is measured (the carried sheet leans and never snaps round,
// the egg leans toward the bowl, the whisk leans into its travel, the lumps go one by one).
//
// The camera rail gets its own checks: a Station hop settles honestly (not before 0.45 s,
// by 1 s) and never jumps; idle swipes turn one Station at a time; a swipe mid-Step only
// tugs the view and comes back. Twelve earlier cakes are seeded into local storage so the
// Shelf shows both of its rows, and the Stove shot must have the oven door at the centre.
//
// The cat acts: it points at what each Step wants within 300 ms of the Step starting and hops
// within 400 ms of every done(), it is whole on screen at the Stove (standing back and leaned
// in to the window), and the chomp takes the cake in bites at an open mouth. A finger cue
// shows at every Step's start and is gone after the first touch. Touching what isn't part of
// the Step is a Nudge: tapping the cat mid-stir counts one, and a press 200 px from the jug
// pours nothing. Every Step's hint names its gesture and its place.
//
// Release polish: Start is faded while it is disabled and the loading line walks through its
// stages; the fonts are self-hosted (Google Fonts is blocked and nothing leaves the origin); the
// home-screen icons and manifest are linked; the reveal has no buttons until the cat's verdict,
// which is also when the cake is saved; the idle Counter shows the swipe chevrons (gone for
// good after one swipe) and the finger cue on the book; no step title overflows its line.
// Side runs: a browser without WebGL gets the friendly message, and fourteen saved cakes put
// an "and 2 more" card on the Shelf that lists cakes #1 and #2.
//
//   npm run build && node test/play.cjs [phone|desktop] [classic|blueberry|lemon] [under|right|over|all]
//
// Env: SHOTS_DIR (where screenshots go), CHROME_PATH (a Chromium binary for Playwright),
// DSF (device scale factor; 3 also saves a close-up of each pour's holding shot).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const DIST = path.join(__dirname, '..', 'dist');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), `cremes-kitchen-shots-${process.pid}`);
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const EXE = process.env.CHROME_PATH || 'C:\\Users\\ediso\\AppData\\Local\\ms-playwright\\chromium-1178\\chrome-win\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.md': 'text/plain', '.txt': 'text/plain', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const NAV_TIMEOUT = 120000;
const MARGIN = 16;        // px: every target must sit at least this far inside the viewport
const CONTACT = 0.003;    // m: boxes that overlap less than this are just resting on each other
/** World point on the counter just in front of the oven and right of the pan's slot. */
const COUNTER_SPOT = [1.05, 0.0005, -0.02];
const PAN_CLEAR = 60;     // px: the parked pan must be at least this far from anything the player aims at
const CAT_MARGIN = 40;    // px: at the Stove the whole cat must sit this far inside the viewport
const HINT_RE = /^(Drag|Circle|Pick up|Press and hold|Tap)/;

/**
 * Pairs whose boxes may overlap, and in which shots. Keys are "a~b" with prop names sorted
 * (a HUD name or "viewport" always last). Everything else that overlaps is a PROBLEM.
 */
const ALLOWED = [
  { pair: /^shelf~shelf\d+$/, why: 'cakes sit on the Shelf; its riser and pink trim lift its box over their bases' },
  { pair: /^shelf~viewport$/, why: 'the Shelf plank is a touch wider than a phone; every cake on it must still be inside' },
  { pair: /^(pan|oven|ovenDoor|fridge|shelf|shelf\d+)~bubble$/, why: "the cat's line docks bottom-left while the cat is out of view (Stove, Fridge)" },
  { pair: /^(oven|ovenDoor)~(viewport|stepHead)$/, why: 'the oven fills the Stove view on purpose' },
  { pair: /^(oven|ovenDoor|pan)~foot$/, shots: /s6-/, why: 'the bake view leans in to the window; the hint and the tag sit over the knob strip' },
  { pair: /^cat~oven$/, shots: /s6-/, why: 'the cat sits on top of the warm oven at the Stove (beside it, a wide lean-in hides it behind the oven)' },
  { pair: /^cat~(viewport|stepHead)$/, shots: /s6-(in-oven|bake|opening|sliding-out)/, tags: ['phone'], why: 'leaning in to the window (and backing off again as the pan comes out), the cat on the oven peeks in from the top-left corner' },
  { pair: /^oven~pan$/, shots: /s6-(in-oven|bake)/, why: 'the pan is inside the oven' },
  { pair: /^(oven|ovenDoor)~pan$/, shots: /s6-(sliding|sliding-out|opening|resting)$/, why: "the pan rides on the open door's top face (the driver checks doorGap: it never sinks into the door)" },
  { pair: /^oven~pan$/, shots: /s6-door-open-hover$/, why: "the oven's box takes in its open door; the pan hovers over it (ovenDoor~pan is still checked)" },
  { pair: /^pan~stepHead$/, shots: /s6-(in-oven|bake)/, why: 'the pan inside the oven sits under the header on wide screens, as the oven does' },
  { pair: /^(bowl|whisk|jug|cup|dish|lemon|cat)~bubble$/, why: 'the bubble floats beside the cat for 3.5 s, over the bowl and whatever is in or over it' },
  { pair: /^(bowl|cat|pan|ring|sheet)~viewport$/, shots: /s1-swipe$/, why: 'the view is tugged 6 cm sideways by a locked swipe in this shot' },
  { pair: /^cake~cat$/, shots: /chomp/, why: "the cake is in the cat's mouth, going down in three bites" },
  { pair: /^cake~bubble$/, shots: /chomp|verdict/, why: "the cake goes to the cat's mouth; its line floats over it for 3.5 s" },
  { pair: /^fridge~(viewport|stepHead)$/, tags: ['desk'], why: 'the fridge is taller than the view and stands at the left edge, under the header on wide screens' },
  { pair: /^(jug|cup|dish|lemon)~viewport$/, shots: /s3-done|s4-(start|item\d-(released|after))/, why: 'vessels slide in from and out to the wings; a shot can catch one crossing the edge (s3-done can land after step 4 has begun)' },
  { pair: /^pan~viewport$/, shots: /s4to5-transition/, why: 'the pan is sliding in from the park slot in this shot' },
  { pair: /^(pan|ring|lining|bowl)~viewport$/, shots: /s1-after$/, why: 'after its 0.35 s beat the lined pan slides off to the park slot as the bowl slides home from the right; a slow headless shot 150 ms after done() can catch either crossing the edge' },
  // The landscape rig looks along the counter, so the step header and its ring sit over the
  // bowl's far rim and whatever is lifted over the bowl. Portrait has room; this is a camera
  // matter (camera.ts), not a slot clash.
  { pair: /^(jug|cup|dish)~stepHead$/, shots: /s4-item\d-(holding|released|after)/, why: "a vessel is held beside the bowl's far-right rim to pour toward the camera; the header's box reaches over it, but never its meter ring (checked separately)" },
  { pair: /^bowl~whisk$/, shots: /s2-/, why: 'the whisk stands in the bowl' },
  { pair: /^carton~egg\d$/, shots: /s3-/, why: 'the eggs sit in the carton cups' },
  { pair: /^(lining~ring|ring~sheet)$/, shots: /s1-/, why: 'the lining sits inside the ring, and the sheet folds down into it (a separate check asserts the lining fits)' },
  { pair: /^bowl~viewport$/, shots: /s5-(released|after)/, tags: ['phone'], aims: ['over'], why: 'an over-long pour tips the emptying bowl past 1 rad; on a phone its rim crosses the screen edges for a moment (the counter camera is too close to fit it; see camera.ts)' },
  { pair: /^bowl~pan$/, shots: /s5-(holding|released|after)/, why: 'the lifted, tipped bowl hangs over the pan (a separate check keeps it on screen, under the header and off the cat)' },
];
/** Twelve earlier cakes, so the Shelf shows both rows (seeded into local storage only when it is empty). */
const SEED = Array.from({ length: 12 }, (_, i) => {
  const q = ['under', 'right', 'over'][i % 3];
  return { n: i + 1, recipe: i % 4 === 3 ? 'tiramisu' : 'basque', flavor: ['classic', 'blueberry', 'lemon'][i % 3], quality: q, verdict: i % 5 === 4 ? undefined : q, date: new Date(2026, 0, 1 + i).toISOString() };
});
/** The same, past the Shelf's dozen: the side run expects an "and 2 more" card listing #1 and #2. */
const SEED14 = Array.from({ length: 14 }, (_, i) => ({ ...SEED[i % 12], n: i + 1, date: new Date(2025, 11, 1 + i).toISOString() }));
const allowed = (key, shotName, aim) => ALLOWED.some((a) => a.pair.test(key) && (!a.shots || a.shots.test(shotName)) && (!a.tags || a.tags.includes(tag)) && (!a.aims || a.aims.includes(aim)));
const HUD_NAMES = new Set(['stepHead', 'foot', 'bubble', 'viewport']);
const pairKey = (a, b) => (HUD_NAMES.has(b) ? `${a}~${b}` : [a, b].sort().join('~'));

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const viewport = process.argv[2] === 'desktop' ? { width: 1280, height: 800 } : { width: 390, height: 844 };
const tag = process.argv[2] === 'desktop' ? 'desk' : 'phone';
const flavor = process.argv[3] || 'blueberry';
const aimArg = process.argv[4] || 'right'; // under | right | over for the bake, or all
const aims = aimArg === 'all' ? ['under', 'right', 'over', 'timeout'] : [aimArg]; // timeout: hold until the dial runs out
const problems = [];
const log = [];
const warns = new Map(); // "a~b" -> shots it was seen in
let browser;
/** The pan's pixels at s5-done per bake aim (the pour is held as long as the bake), so "right" and "over" can be compared. */
const panShots = {};
let panClip = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rectsCross = (a, b) => a && b && a.w > 0 && a.h > 0 && b.w > 0 && b.h > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/**
 * How deeply two convex footprints (counter-clockwise [x, z] polygons) overlap: the least
 * overlap along any edge normal (separating axis theorem), 0 if some axis separates them.
 */
const hullOverlap = (a, b) => {
  if (a.length < 2 || b.length < 2) return Infinity; // nothing to test; the boxes decide
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length];
      const nx = z0 - z1, nz = x1 - x0; // edge normal (length cancels out below)
      const len = Math.hypot(nx, nz);
      if (len < 1e-9) continue;
      const project = (p) => p.reduce(([lo, hi], [x, z]) => { const d = (x * nx + z * nz) / len; return [Math.min(lo, d), Math.max(hi, d)]; }, [Infinity, -Infinity]);
      const [a0, a1] = project(a), [b0, b1] = project(b);
      depth = Math.min(depth, Math.min(a1, b1) - Math.max(a0, b0));
      if (depth <= 0) return 0;
    }
  }
  return depth;
};
/** Two props touch when their heights and their footprints both overlap by more than a resting contact. */
const boxesCross = (a, b) => Math.min(a.world.max[1], b.world.max[1]) - Math.max(a.world.min[1], b.world.min[1]) > CONTACT
  && [0, 2].every((i) => Math.min(a.world.max[i], b.world.max[i]) - Math.max(a.world.min[i], b.world.min[i]) > CONTACT)
  && hullOverlap(a.hull, b.hull) > CONTACT;

async function play(page, aim, prefix) {
  const problem = (text) => problems.push(prefix ? `[${aim}] ${text}` : text);
  const expect = aim === 'timeout' ? 'over' : aim;
  let idleCounter = null;
  let n = 0;
  const state = () => page.evaluate(() => window.__game.state());
  const boxes = () => page.evaluate(() => window.__game.boxes());
  const progress = async () => (await state()).progress;
  const slowmo = (x) => page.evaluate((x) => window.__game.slowmo(x), x);

  /** Targets the game advertises; each one must be comfortably inside the viewport (except `parked` ones). */
  const targets = async (where, parked = []) => {
    const t = await page.evaluate(() => window.__game.targets());
    for (const [k, p] of Object.entries(t)) {
      if (parked.includes(k)) continue;
      if (p.x < MARGIN || p.y < MARGIN || p.x > viewport.width - MARGIN || p.y > viewport.height - MARGIN) {
        problem(`target ${k} off viewport (${Math.round(p.x)},${Math.round(p.y)})${where ? ' at ' + where : ''}`);
      }
    }
    return t;
  };

  /** During the egg and pour Steps the pan is parked: it must be nowhere near what the player aims at. */
  const panClear = (t, where) => {
    if (!t.pan) { problem(`no pan target at ${where}`); return; }
    for (const [k, p] of Object.entries(t)) {
      if (k === 'pan') continue;
      const d = Math.hypot(p.x - t.pan.x, p.y - t.pan.y);
      if (d < PAN_CLEAR) problem(`pan only ${Math.round(d)} px from ${k} at ${where}`);
    }
  };

  /** Screenshot, then look at what overlaps what in that frame. Returns the boxes it saw. */
  const shot = async (name) => {
    await page.screenshot({ path: path.join(SHOTS, `${tag}-${prefix}${String(++n).padStart(2, '0')}-${name}.png`) });
    const b = await boxes();
    const overlap = (key) => {
      if (allowed(key, name, expect)) { if (!warns.has(key)) warns.set(key, []); warns.get(key).push(prefix + name); return; }
      const [a, c] = key.split('~');
      problem(`${a} overlaps ${c} (${prefix}${name})`);
    };
    const names = Object.keys(b.props);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = b.props[names[i]], c = b.props[names[j]];
        if (a.parent === names[j] || c.parent === names[i]) continue; // the oven door is part of the oven
        if (boxesCross(a, c)) overlap(pairKey(names[i], names[j]));
      }
    }
    const view = { x: 0, y: 0, w: b.viewport.w, h: b.viewport.h }, shotName = name;
    for (const [name, p] of Object.entries(b.props)) {
      const s = p.screen;
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const near = cx >= 0 && cx <= view.w && cy >= 0 && cy <= view.h; // props at other Stations are off screen on purpose
      if (near && (s.x < 0 || s.y < 0 || s.x + s.w > view.w || s.y + s.h > view.h)) overlap(`${name}~viewport`);
      for (const [hudName, r] of Object.entries(b.hud)) if (rectsCross(s, r)) overlap(`${name}~${hudName}`);
      if (/^(jug|cup|dish|lemon)$/.test(name) && rectsCross(s, b.ring)) problem(`${name} covers the meter ring (${prefix}${shotName})`);
    }
    if (rectsCross(b.hud.bubble, b.hud.stepHead)) problem(`bubble overlaps the step header (${name})`);
    // Room: the prop the finger is handling never covers the cat's face or sits under its bubble.
    {
      const r = await page.evaluate(() => window.__game.room());
      if (r.focus) {
        const f = r.focus, c = r.face;
        const inside = c.x > f.x && c.x < f.x + f.w && c.y > f.y && c.y < f.y + f.h;
        log.push(`room ${prefix}${name}: focus ${Math.round(f.x)},${Math.round(f.y)} ${Math.round(f.w)}x${Math.round(f.h)}, face ${Math.round(c.x)},${Math.round(c.y)}`);
        if (inside && b.props.cat) problem(`the prop in hand covers the cat's face (${prefix}${name})`);
        if (r.bubbleVisible && rectsCross(b.hud.bubble, f)) problem(`the cat's bubble sits over the prop in hand (${prefix}${name})`);
      }
    }
    // The cat's hat must never be cut off by the top edge (the landscape camera gives it headroom).
    const cat = b.props.cat;
    if (cat && cat.screen.x + cat.screen.w / 2 > 0 && cat.screen.x + cat.screen.w / 2 < view.w && cat.screen.y < 8) problem(`cat cut off at the top (y=${Math.round(cat.screen.y)}) at ${name}`);
    const s = await state();
    // Between lining the pan and filling it (stir, eggs, pour) the pan is parked out of sight.
    if (s.phase === 'baking' && s.step >= 1 && s.step <= 3 && b.props.pan) problem(`the pan is still out at ${name}`);
    if (s.step === 3 && s.visible && s.visible.length > 1) problem(`${s.visible.length} pourables out at once (${s.visible.join(', ')}) at ${name}`);
    return b;
  };

  /** The colour of one screen pixel, decoded by the page from a tiny clip screenshot. */
  const pixelAt = async (x, y) => {
    const clip = { x: Math.max(0, Math.round(x) - 2), y: Math.max(0, Math.round(y) - 2), width: 5, height: 5 };
    const b64 = (await page.screenshot({ clip })).toString('base64');
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = c.height = 5;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return Array.from(g.getImageData(2, 2, 1, 1).data).slice(0, 3);
    }, b64);
  };
  /** The darkest of a few spots (offsets in px) around a point, from one clip screenshot. */
  const darkestSpot = async (x, y, spots) => {
    const rx = Math.max(...spots.map(([dx]) => Math.abs(dx))), ry = Math.max(...spots.map(([, dy]) => Math.abs(dy)));
    const clip = { x: Math.max(0, Math.round(x) - rx), y: Math.max(0, Math.round(y) - ry), width: rx * 2 + 1, height: ry * 2 + 1 };
    const b64 = (await page.screenshot({ clip })).toString('base64');
    return page.evaluate(async ({ b64, spots, ox, oy, w, h }) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, w, h).data;
      let best = null;
      for (const [dx, dy] of spots) {
        const i = ((oy + dy) * w + ox + dx) * 4;
        const q = [data[i], data[i + 1], data[i + 2]];
        if (!best || q[0] + q[1] + q[2] < best[0] + best[1] + best[2]) best = q;
      }
      return best;
    }, { b64, spots, ox: Math.round(x) - clip.x, oy: Math.round(y) - clip.y, w: clip.width, h: clip.height });
  };
  // The cat's fur against the wooden counter: fur is a touch lighter and pinker (measured on the phone render).
  // Fur, lit or in the shade of the chest (a pointing paw is up in front of it): 231,195,157 seen there on desktop.
  const furLike = ([r, g, b]) => r >= 220 && g >= 185 && g <= 240 && b >= 145 && b <= 225 && r - b >= 30;

  const ringCheck = async (where, sel = '#ring') => {
    const box = await page.locator(sel).boundingBox();
    if (!box || box.height <= 0 || box.width <= 0) { problem(`ring not visible (${where})`); return; }
    if (box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) problem(`ring outside the viewport (${where})`);
    const head = await page.locator('#step-head').boundingBox();
    if (head && (box.y < head.y - 1 || box.y + box.height > head.y + head.height + 1)) problem(`ring sticks out of the header (${where}: ring ${Math.round(box.y)}-${Math.round(box.y + box.height)}, header ${Math.round(head.y)}-${Math.round(head.y + head.height)})`);
  };
  /** The counter by the oven must look as it does with the oven cold: its light stays inside. */
  const counterCheck = async (where) => {
    if (!idleCounter) return;
    const c = await page.evaluate(([x, y, z]) => window.__game.screenOf(x, y, z), COUNTER_SPOT);
    // Leaning in to the window, the spot can be out of the view: nothing to compare then.
    if (c.x < 3 || c.y < 3 || c.x > viewport.width - 3 || c.y > viewport.height - 3) { log.push(`counter by the oven at ${where}: out of view`); return; }
    const px = await pixelAt(c.x, c.y);
    const diff = Math.max(...px.map((v, i) => Math.abs(v - idleCounter[i])));
    log.push(`counter by the oven at ${where}: ${px.join(',')} (${diff} from idle)`);
    if (diff > 12) problem(`the counter by the oven changed colour at ${where} (${px.join(',')} vs idle ${idleCounter.join(',')})`);
  };
  /**
   * Step 6's hold. A first hold is let go while the top is still pale: that only pauses the
   * oven. A second hold carries on through the stages (a shot as each one arrives, reading
   * the top's colour through the window) and lets go at `until`, or never, so the dial runs
   * out. Returns the pan's top colour at the end of the bake.
   */
  const bakeHold = async (at, until) => {
    const stages = {};
    const stageShot = async (s) => {
      // the cat's call is read before the (slow) screenshot: its bubble lasts a few real seconds
      const pr = await page.evaluate(() => window.__game.probe());
      const said = pr.bubbleVisible ? await page.locator('#bubble').innerText() : '';
      await shot(`s6-bake-${s.stage}`);
      const tt = await page.evaluate(() => window.__game.targets());
      // Once it smokes, the darkest of five spots across the top: a grey puff over one of them is not the crust.
      const spots = s.stage === 'charred' ? [[0, 0], [-18, 0], [18, 0], [0, -6], [0, 6]] : [[0, 0]];
      const px = tt.top ? await darkestSpot(tt.top.x, tt.top.y, spots) : null;
      const d = await page.evaluate(() => window.__game.debug());
      stages[s.stage] = { px, smoke: d.smoke };
      log.push(`s6 ${s.stage} at p=${s.progress.toFixed(2)}: top ${px && px.join(',')} smoke ${d.smoke}`);
      if (s.stage === 'charred' || s.stage === 'burnt') await counterCheck(`s6-bake-${s.stage}`);
      // The cat calls the stages from beside the oven; on the burnt one it says to let go.
      // (On a phone the lean-in is no wider than the window: the cat on the oven is just off the
      // left edge there, and its bubble carries the call.)
      if (!pr.catOnScreen) problem(`the cat is off screen at s6-bake-${s.stage}`);
      if (s.stage !== 'pale' && !pr.bubbleVisible) problem(`no cat bubble calling the ${s.stage} stage`);
      if (s.stage === 'burnt') {
        const text = said;
        log.push(`s6 burnt: cat says "${text}"`);
        if (!/let go/i.test(text)) problem(`the cat's bubble does not say "Let go" when the top turns BURNT ("${text}")`);
      }
    };
    // Half speed, so the shots on the way do not eat into the stages.
    await slowmo(2);
    // First hold: let go at 0.2, still pale.
    await page.mouse.move(at.x, at.y);
    await mark('s6-down');
    await page.mouse.down();
    let t0 = Date.now();
    while (Date.now() - t0 < 10000) {
      const s = await state();
      if (!stages.pale && s.progress >= 0.1) await stageShot(s);
      else if (s.progress >= 0.2) break;
      else await page.waitForTimeout(20);
    }
    await page.mouse.up();
    await mark('s6-up');
    await page.waitForTimeout(500);
    let s = await state();
    const hint = await page.locator('#hint').innerText();
    log.push(`s6 let go while pale at p=${s.progress.toFixed(2)}: step ${s.step}, paused ${s.paused}, hint "${hint}"`);
    if (s.step !== 5 || s.bakePhase !== 'bake') problem(`letting go while pale ended the bake (step ${s.step}, ${s.bakePhase})`);
    if (Math.abs(s.progress - 0.2) > 0.05) problem(`letting go while pale left progress at ${s.progress.toFixed(2)}, expected about 0.2`);
    if (!/keep holding/i.test(hint)) problem(`no "keep holding" hint after letting go while pale ("${hint}")`);
    await page.waitForTimeout(400);
    const s2 = await state();
    if (s2.progress !== s.progress) problem(`the paused bake kept going (${s.progress.toFixed(3)} -> ${s2.progress.toFixed(3)})`);
    await shot('s6-bake-paused');

    // Second hold: on through the stages.
    await page.mouse.move(at.x, at.y);
    await mark('s6-down');
    await page.mouse.down();
    t0 = Date.now();
    let released = false, ringDone = false, last = 0, holdingShot = false;
    while (Date.now() - t0 < 20000) {
      s = await state();
      if (s.step !== 5 || s.bakePhase !== 'bake') break; // the dial ran out and the bake ended on its own
      last = s.progress;
      if (s.progress <= s2.progress + 1e-6 && Date.now() - t0 > 500) { problem('a second hold did not carry the bake on'); break; }
      if (!stages[s.stage]) { await stageShot(s); continue; }
      if (!holdingShot && s.progress >= s2.progress + 0.04) {
        holdingShot = true;
        const b = await shot('s6-bake-holding');
        catInside(b, 's6-bake-holding');
        const c = (await state()).cat;
        log.push(`s6-bake-holding: cat ${c.action}, head out ${(c.headLean * 1000).toFixed(1)} mm`);
        if (c.action !== 'lean') problem(`the cat is not leaning in to watch the oven while it bakes (${c.action})`);
        continue;
      }
      if (!ringDone && s.progress > 0.35) { ringDone = true; await ringCheck('s6-bake', '#bake'); if (await page.locator('#ring').isVisible()) problem('the ring meter shows during the bake (the bake gauge is its one judge)'); }
      if (s.progress >= until) { await page.mouse.up(); released = true; break; }
      await page.waitForTimeout(20);
    }
    if (!released) await page.mouse.up();
    await mark('s6-up');
    await slowmo(1);
    const end = await page.evaluate(() => window.__game.probe());
    log.push(`s6-bake: ${released ? `released at p=${last.toFixed(2)}` : `held until the dial ran out (p=${last.toFixed(2)})`}, top ${end.fillHex}`);
    await shot('s6-bake-released');

    // Each stage looks different through the window, and only a charred top smokes.
    const ids = Object.keys(stages);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = stages[ids[i]].px, b = stages[ids[j]].px;
        if (!a || !b) continue;
        const diff = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
        if (diff < 20) problem(`the ${ids[i]} and ${ids[j]} tops look the same through the window (${a.join(',')} vs ${b.join(',')})`);
      }
    }
    for (const id of ids) {
      if (id === 'charred' && !(stages[id].smoke > 0)) problem('no smoke off the charred top');
      if (id !== 'charred' && stages[id].smoke > 0) problem(`smoke while the top is only ${id}`);
    }
    const want = { under: ['pale', 'golden'], right: ['pale', 'golden', 'burnt'], over: ['pale', 'golden', 'burnt', 'charred'] }[expect];
    for (const id of want) if (!stages[id]) problem(`no shot of the ${id} stage`);
    return end.fillHex;
  };
  /** RGB of a screen rectangle, every other pixel, decoded by the page. */
  const pixelsIn = async (clip) => {
    const b64 = (await page.screenshot({ clip })).toString('base64');
    return page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const out = [];
      for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) { const i = (y * c.width + x) * 4; out.push(d[i], d[i + 1], d[i + 2]); }
      return out;
    }, b64);
  };
  /** The whole cat on screen, CAT_MARGIN px clear of every edge (b: a boxes() reading). */
  const catInside = (b, where) => {
    const c = b.props.cat && b.props.cat.screen;
    if (!c) { problem(`no cat at ${where}`); return; }
    log.push(`cat at ${where}: ${Math.round(c.x)}-${Math.round(c.x + c.w)} x ${Math.round(c.y)}-${Math.round(c.y + c.h)}`);
    if (c.x < CAT_MARGIN || c.y < CAT_MARGIN || c.x + c.w > viewport.width - CAT_MARGIN || c.y + c.h > viewport.height - CAT_MARGIN) problem(`the cat is not whole on screen at ${where} (${Math.round(c.x)},${Math.round(c.y)} ${Math.round(c.w)}x${Math.round(c.h)})`);
  };
  /** The finger cue shows at a Step's start... */
  const cueOn = async (where) => {
    const c = await page.evaluate(() => window.__game.cue());
    log.push(`cue at ${where}: ${c}`);
    if (!c) problem(`no finger cue at ${where}`);
    return c;
  };
  /** ...and is gone once the player has touched the thing. */
  const cueOff = async (where) => {
    const c = await page.evaluate(() => window.__game.cue());
    if (c) problem(`the finger cue (${c}) still shows after the first touch at ${where}`);
  };
  // Settled: the view has stopped and no Step-to-Step transition is under way.
  const settle = async () => { await page.waitForFunction(() => { const s = window.__game.state(); return s.settled && !s.transition; }, null, { timeout: 8000 }); await page.waitForTimeout(150); };
  /** Wait for the current Step's done(): the transition starts with the cat's reaction. Returns the game time it did. */
  const waitDone = async (step, what) => {
    const ok = await page.waitForFunction((i) => { const s = window.__game.state(); return s.step !== i || (s.transition && s.transition !== 'arrive'); }, step, { timeout: 8000 }).then(() => true).catch(() => false);
    if (!ok) { problem(`${what}: never saw done()`); return null; }
    const w = await page.evaluate(() => window.__t10.trans);
    return w.find((e) => e.step === step && e.to === 'react')?.time ?? null;
  };
  const drag = async (from, to, steps = 18) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.move(to.x, to.y, { steps });
    await page.waitForTimeout(120);
    await page.mouse.up();
  };

  /**
   * Press at a point and keep holding. Takes the "holding" shot partway (so it shows the
   * pour, not the end of it), lets go the moment progress reaches `until`, and shoots the
   * result right away and again 150 ms later.
   */
  const hold = async (at, until, label) => {
    const s0 = await state();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const t0 = Date.now();
    let shotTaken = false;
    let released = false;
    let last = 0; // progress at the moment we let go (the meter resets right after)
    while (Date.now() - t0 < 40000) {
      const s = await state();
      last = s.progress;
      if (s.step !== s0.step) break; // the meter filled up and the Step finished on its own
      if (!shotTaken && s.progress >= 0.45 * until) {
        shotTaken = true;
        await shot(`${label}-holding`);
        if (Number(process.env.DSF) >= 2) {
          const c = (await page.evaluate(() => window.__game.targets())).anywhere;
          await page.screenshot({ path: path.join(SHOTS, `${tag}-${prefix}${label}-closeup.png`), clip: { x: Math.max(0, c.x - 110), y: Math.max(0, c.y - 150), width: 220, height: 220 } });
        }
        await ringCheck(`${label}-holding`);
        const after = await state();
        log.push(`${label}: holding shot at p=${s.progress.toFixed(2)} -> ${after.progress.toFixed(2)} (${s.stage})`);
        if (after.progress >= 0.95) problem(`${label}: holding shot landed too late (p=${after.progress.toFixed(2)} after it)`);
        if (after.step !== s0.step) problem(`${label}: step changed during the holding shot`);
        continue;
      }
      if (s.progress >= until) { await page.mouse.up(); released = true; break; }
      await page.waitForTimeout(20);
    }
    if (!released) {
      await page.mouse.up();
      if (!shotTaken) problem(`${label}: hold never reached ${until}`);
    }
    const s1 = await state();
    log.push(`${label}: released at p=${last.toFixed(2)}`);
    if (s1.station !== s0.station) problem(`${label}: station changed mid-step (${s0.station} -> ${s1.station})`);
    await shot(`${label}-released`);
    await page.waitForTimeout(150);
    await shot(`${label}-after`);
  };
  /**
   * Hold to pour one vessel of Step 4, watching the pour as it goes (game seconds, from
   * the Step's debug numbers): the vessel is carried level before it tips, the meter only
   * runs once it is tipped, a steady cream pour leaves the spout and lands right under it,
   * the stream thins as it falls, and after letting go the stream leaves the lip, lands,
   * and the drops and the level settle. On the first vessel the finger also slides
   * sideways mid-pour and the vessel must follow it.
   */
  const pourHold = async (at, until, label, i) => {
    const s0 = await state();
    const name = s0.itemName;
    if (i === 0) {
      // A press 200 px from the jug is a Nudge: nothing is picked up and nothing pours.
      const away = [[-200, 0], [200, 0], [0, 200], [0, -200]].map(([dx, dy]) => ({ x: at.x + dx, y: at.y + dy }))
        .find((p) => p.x > 20 && p.y > 20 && p.x < viewport.width - 20 && p.y < viewport.height - 20);
      const n0 = (await state()).nudges;
      await page.mouse.move(away.x, away.y);
      await page.mouse.down();
      await page.waitForTimeout(600);
      const s = await state();
      await page.mouse.up();
      log.push(`${label}: a press 200 px from the jug: progress ${s.progress.toFixed(3)}, holding ${s.holding}, nudges ${n0} -> ${s.nudges}`);
      if (s.progress !== 0 || s.holding) problem(`${label}: a press 200 px from the jug poured (progress ${s.progress.toFixed(3)}, holding ${s.holding})`);
      await page.waitForTimeout(300);
    }
    // cream and lemon pour liquid (a stream, drops); flour sifts as a cloud; berries are balls
    const liquid = name === 'cream' || name === 'lemon';
    await page.mouse.move(at.x, at.y);
    await mark(`s4-${name}-down`);
    await page.mouse.down();
    const t0 = Date.now();
    let shotTaken = false, released = false, dragged = false, last = 0;
    let steadyChecked = 0, maxDrops = 0;
    // per-kind watches: flour never shows a rod and its cloud and dusting grow; the lemon is squeezed in pulses
    let samples = 0, streamShown = 0, maxFlour = 0, dust = 0, squeezedLow = 0, wasLow = false, maxWidth = 0;
    while (Date.now() - t0 < 40000) {
      const s = await state();
      if (s.step !== s0.step) break;
      last = s.progress;
      // held beside the bowl, never in it: the vessel's lowest point stays over the rim plane
      if (s.vesselClear != null && s.vesselClear < 0) problem(`${label}: the vessel dips ${(-s.vesselClear * 1000).toFixed(1)} mm below the bowl's rim (tilt ${s.tilt.toFixed(2)})`);
      if (s.holdT < 0.3 && s.tilt >= 0.1) problem(`${label}: tilted ${s.tilt.toFixed(2)} rad only ${s.holdT.toFixed(2)} s into the hold (it should be carried level)`);
      if (s.tilt < 0.9 * s.tiltTarget && s.progress > 0) problem(`${label}: meter at ${s.progress.toFixed(2)} before the vessel tipped (tilt ${s.tilt.toFixed(2)} of ${s.tiltTarget.toFixed(2)})`);
      if (s.streamActive || s.berries || name === 'lemon') maxDrops = Math.max(maxDrops, s.droplets);
      samples++;
      if (s.streamVisible) streamShown++;
      if (name === 'flour') {
        if (s.streamVisible) problem(`${label}: a stream is showing for the flour at p=${s.progress.toFixed(2)}`);
        maxFlour = Math.max(maxFlour, s.flour);
        if (s.dustRadius + 1e-6 < dust) problem(`${label}: dusting patch shrank (${(dust * 1000).toFixed(1)} -> ${(s.dustRadius * 1000).toFixed(1)} mm)`);
        dust = Math.max(dust, s.dustRadius);
      }
      if (name === 'lemon') {
        const low = s.squeeze <= 0.8;
        if (low && !wasLow) squeezedLow++;
        wasLow = low;
        maxWidth = Math.max(maxWidth, s.streamWidth);
      }
      if (name === 'cream' && s.progress > 0.5 && s.yolks > 0) problem(`${label}: ${s.yolks} yolk(s) still showing at p=${s.progress.toFixed(2)}`);
      if (name === 'cream' && !dragged && s.streamActive && s.landedFraction >= 0.99) {
        steadyChecked++;
        if (s.lipErr > 0.003) problem(`${label}: stream starts ${(s.lipErr * 1000).toFixed(1)} mm from the lip`);
        if (s.lipAxis >= s.rimLimit) problem(`${label}: lip ${(s.lipAxis * 100).toFixed(1)} cm from the bowl axis (limit ${(s.rimLimit * 100).toFixed(1)})`);
        if (s.lipLanding > 0.015) problem(`${label}: stream lands ${(s.lipLanding * 100).toFixed(1)} cm from under the lip`);
        if (s.widthRatio > 0.7) problem(`${label}: stream barely thins (landing/lip width ${s.widthRatio.toFixed(2)})`);
      }
      if (!shotTaken && s.progress >= 0.45 * until) {
        shotTaken = true;
        await shot(`${label}-holding`);
        if (Number(process.env.DSF) >= 2) {
          const c = (await page.evaluate(() => window.__game.targets())).anywhere;
          await page.screenshot({ path: path.join(SHOTS, `${tag}-${prefix}${label}-closeup.png`), clip: { x: Math.max(0, c.x - 110), y: Math.max(0, c.y - 150), width: 220, height: 220 } });
        }
        await ringCheck(`${label}-holding`);
        const after = await state();
        log.push(`${label}: holding shot at p=${s.progress.toFixed(2)} -> ${after.progress.toFixed(2)} (${s.stage}) tilt ${s.tilt.toFixed(2)} drops ${s.droplets} mound ${(s.mound * 1000).toFixed(1)} mm flour ${s.flour} berries in the air ${s.berriesAir ?? 0}`);
        if (name === 'flour' && s.flour <= 60) problem(`${label}: only ${s.flour} flour flakes in the air mid-pour`);
        if (after.progress >= 0.95) problem(`${label}: holding shot landed too late (p=${after.progress.toFixed(2)} after it)`);
        if (after.step !== s0.step) problem(`${label}: step changed during the holding shot`);
        continue;
      }
      if (i === 0 && shotTaken && !dragged && s.progress >= 0.5 * until) {
        // Slide the finger 60 px to the left mid-pour: the jug follows.
        dragged = true;
        const before = (await page.evaluate(() => window.__game.targets())).item;
        for (let k = 1; k <= 10; k++) { await page.mouse.move(at.x - 6 * k, at.y); await page.waitForTimeout(15); }
        await page.waitForTimeout(500);
        const after = (await page.evaluate(() => window.__game.targets())).item;
        const moved = before && after ? Math.abs(after.x - before.x) : 0;
        log.push(`${label}: finger slid 60 px, vessel moved ${moved.toFixed(0)} px`);
        if (moved <= 15) problem(`${label}: vessel did not follow the finger (moved ${moved.toFixed(0)} px for a 60 px slide)`);
        continue;
      }
      if (s.progress >= until) { await page.mouse.up(); released = true; break; }
      await page.waitForTimeout(15);
    }
    if (!released) {
      await page.mouse.up();
      if (!shotTaken) problem(`${label}: hold never reached ${until}`);
    }
    await mark(`s4-${name}-up`);
    log.push(`${label}: released at p=${last.toFixed(2)}`);
    if (!(last > 0)) problem(`${label}: a hold on the vessel did not pour`);
    if (name === 'cream' && !steadyChecked) problem(`${label}: never saw a steady cream pour to check`);
    if (liquid && maxDrops === 0) problem(`${label}: no droplets while pouring`);
    if (name === 'flour') {
      log.push(`${label}: flour cloud up to ${maxFlour} flakes, dusting ${(dust * 2000).toFixed(0)} mm across`);
      if (maxFlour <= 60) problem(`${label}: flour cloud never got past ${maxFlour} flakes`);
      if (dust <= 0) problem(`${label}: no dusting on the batter`);
    }
    if (name === 'lemon') {
      const frac = samples ? streamShown / samples : 0;
      log.push(`${label}: ${squeezedLow} squeezes, thread up to ${(maxWidth * 1000).toFixed(1)} mm wide, showing ${(frac * 100).toFixed(0)}% of the hold`);
      if (squeezedLow < 2) problem(`${label}: the lemon was squeezed ${squeezedLow} time(s) in a full hold`);
      if (maxWidth > 0.002) problem(`${label}: lemon thread ${(maxWidth * 1000).toFixed(1)} mm wide`);
      if (frac >= 0.4) problem(`${label}: lemon thread showing ${(frac * 100).toFixed(0)}% of the hold`);
    }
    // After letting go: watch the tail fall, the drips, and the level.
    let shots = 0, level0 = null, sawGone = false, tFirst = Date.now(), berriesChecked = false;
    while (Date.now() - tFirst < 15000) {
      const s = await state();
      if (s.step !== s0.step || s.releasedFor === undefined) { log.push(`${label}: after-release watch ended (step ${s.step}, releasedFor ${s.releasedFor}, transition ${s.transition})`); break; }
      // the release reaches the Step's numbers on the next frame
      if (s.releasedFor < 0) { if (Date.now() - tFirst > 2000) break; await page.waitForTimeout(10); continue; }
      const r = s.releasedFor;
      if (liquid && r >= 0.15 && s.streamNearLip < 0.005) problem(`${label}: stream still at the lip ${r.toFixed(2)} s after letting go (${(s.streamNearLip * 1000).toFixed(1)} mm)`);
      if (liquid && r >= 0.35 && s.streamActive) problem(`${label}: stream still falling ${r.toFixed(2)} s after letting go`);
      if (r >= 1 && s.droplets > 0) problem(`${label}: ${s.droplets} droplets still flying ${r.toFixed(2)} s after letting go`);
      if (r >= 1 && s.flour > 0) problem(`${label}: ${s.flour} flour flakes still in the air ${r.toFixed(2)} s after letting go`);
      if (name === 'flour' && s.streamVisible) problem(`${label}: a stream is showing for the flour after letting go`);
      if (name === 'blueberries' && r >= 0.75 && !berriesChecked) {
        // every berry that left the dish has sunk into the batter, inside its edge
        berriesChecked = true;
        const e = s.embedded || [];
        log.push(`${label}: ${e.length} berries in the batter, ${s.berriesInDish} left in the dish of ${s.berriesStart}, up to ${s.berriesAirMax} in the air at once`);
        if (e.length < 10) problem(`${label}: only ${e.length} berries in the batter`);
        for (const [d, dy] of e) {
          if (d >= s.embedLimit) problem(`${label}: a berry ${(d * 100).toFixed(1)} cm from the bowl axis, past the batter's edge (${(s.embedLimit * 100).toFixed(1)} cm)`);
          if (Math.abs(dy) >= 0.006) problem(`${label}: a berry ${(dy * 1000).toFixed(1)} mm off the surface`);
        }
        if (s.berriesInDish >= s.berriesStart) problem(`${label}: the dish still holds ${s.berriesInDish} of ${s.berriesStart} berries`);
        if (s.berriesLost > 0) problem(`${label}: ${s.berriesLost} berries got away from the bowl`);
        if (!(s.berriesAirMax >= 1)) problem(`${label}: never saw a berry in the air between the dish and the batter`);
      }
      if (r >= 0.2) {
        if (level0 === null) level0 = s.level;
        else if (Math.abs(s.level - level0) >= 0.0005) problem(`${label}: bowl level still moving ${r.toFixed(2)} s after letting go (${((s.level - level0) * 1000).toFixed(2)} mm)`);
      }
      if (!s.streamActive) sawGone = true;
      if (shots === 0) { shots++; await shot(`${label}-released`); continue; }
      // (the berries are checked first: the Step moves on soon after the last one)
      if (shots === 1 && Date.now() - tFirst > 150 && (name !== 'blueberries' || berriesChecked)) { shots++; await shot(`${label}-after`); continue; }
      if (r >= 1.05) break;
      await page.waitForTimeout(15);
    }
    if (shots < 2) { await shot(`${label}-after`); }
    if (liquid && !sawGone) problem(`${label}: the stream never finished falling after letting go`);
    if (name === 'blueberries' && !berriesChecked) problem(`${label}: never got to check where the berries went`);
  };
  /**
   * Step 5: hold to pour the bowl into the pan, as long as the bake will be held (so the
   * "right" and "over" pans can be compared). Watches the fill spread from a mound, checks
   * the tipped bowl and its level batter mid-pour, and after letting go waits for the bowl
   * to be set down and checks what is left in it and what went into the pan.
   */
  const pourPanHold = async (at, until) => {
    const s0 = await state();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const t0 = Date.now();
    let shotTaken = false, released = false, r10 = null, r30 = null, last = 0, strays = 0;
    const shotAt = Math.min(0.5, Math.max(0.32, 0.45 * until));
    while (Date.now() - t0 < 40000) {
      const s = await state();
      if (s.step !== s0.step) break;
      last = s.progress;
      strays = Math.max(strays, s.strays || 0);
      if (r10 === null && s.progress >= 0.08 && s.progress <= 0.12) r10 = s.panRadius;
      if (r30 === null && s.progress >= 0.3) r30 = s.panRadius;
      if (!shotTaken && s.progress >= shotAt) {
        shotTaken = true;
        const b = await shot('s5-holding');
        const d = await state();
        const tt = await page.evaluate(() => window.__game.targets());
        await ringCheck('s5-holding');
        log.push(`s5: holding shot at p=${d.progress.toFixed(2)} tilt ${d.tilt.toFixed(2)} surface up ${d.surfUpDeg.toFixed(1)} deg shifted ${(d.surfShift * 1000).toFixed(1)} mm, lip ${(d.lipHeight * 100).toFixed(1)} cm over the pan floor, arc ${(d.arc * 1000).toFixed(0)} mm, mound ${(d.panRise * 1000).toFixed(1)} mm, pan r ${(d.panRadius * 1000).toFixed(0)} mm`);
        if (d.progress < 0.3 || d.progress > 0.6) problem(`s5: holding shot at p=${d.progress.toFixed(2)}, not 0.3-0.6`);
        if (d.tilt < 0.4) problem(`s5: bowl only tipped ${d.tilt.toFixed(2)} rad mid-pour`);
        if (!d.surfVisible) problem('s5: no batter surface in the tipped bowl');
        else {
          if (d.surfUpDeg > 5) problem(`s5: the batter tips with the bowl (${d.surfUpDeg.toFixed(1)} deg from level)`);
          if (d.surfShift < 0.002) problem(`s5: the batter did not slide toward the lip (${(d.surfShift * 1000).toFixed(1)} mm)`);
        }
        if (!d.streamActive) problem('s5: no stream mid-pour');
        else {
          if (d.lipErr > 0.003) problem(`s5: stream starts ${(d.lipErr * 1000).toFixed(1)} mm from the lip`);
          if (d.arc < 0.005) problem(`s5: stream falls straight down from the lip (arc ${(d.arc * 1000).toFixed(1)} mm)`);
          if (!d.landInPan) problem('s5: stream lands outside the pan');
          if (d.panRise < 0.002) problem(`s5: no mound where the stream lands (${(d.panRise * 1000).toFixed(1)} mm)`);
        }
        const bowl = b.props.bowl && b.props.bowl.screen, pan = b.props.pan && b.props.pan.screen, head = b.hud.stepHead;
        if (!bowl) problem('s5: no bowl box mid-pour');
        else {
          if (bowl.x < 0 || bowl.y < 0 || bowl.x + bowl.w > viewport.width || bowl.y + bowl.h > viewport.height) problem(`s5: lifted bowl leaves the viewport (${Math.round(bowl.x)},${Math.round(bowl.y)} ${Math.round(bowl.w)}x${Math.round(bowl.h)})`);
          if (rectsCross(bowl, head)) problem(`s5: lifted bowl reaches up under the header (bowl top ${Math.round(bowl.y)}, header bottom ${Math.round(head.y + head.h)})`);
          if (bowl.h > 0.55 * viewport.height) problem(`s5: lifted bowl is ${Math.round((100 * bowl.h) / viewport.height)}% of the screen tall`);
          const c = tt.catHead;
          log.push(`s5-holding: bowl on screen ${Math.round(bowl.x)}-${Math.round(bowl.x + bowl.w)} x ${Math.round(bowl.y)}-${Math.round(bowl.y + bowl.h)}, cat head at ${c && Math.round(c.x)},${c && Math.round(c.y)}`);
          if (c && c.x > bowl.x && c.x < bowl.x + bowl.w && c.y > bowl.y && c.y < bowl.y + bowl.h) problem(`s5: the lifted bowl covers the head of the cat (head ${Math.round(c.x)},${Math.round(c.y)}, bowl ${Math.round(bowl.x)}-${Math.round(bowl.x + bowl.w)} x ${Math.round(bowl.y)}-${Math.round(bowl.y + bowl.h)})`);
        }
        if (tt.landing && pan && !(tt.landing.x > pan.x && tt.landing.x < pan.x + pan.w && tt.landing.y > pan.y && tt.landing.y < pan.y + pan.h)) problem('s5: stream lands outside the pan on screen');
        continue;
      }
      if (s.progress >= until) { await page.mouse.up(); released = true; break; }
      await page.waitForTimeout(15);
    }
    if (!released) { await page.mouse.up(); if (!shotTaken) problem(`s5: hold never reached ${until}`); }
    await mark('s5-up');
    log.push(`s5: released at p=${last.toFixed(2)}, pan radius ${r10 && (r10 * 1000).toFixed(0)} mm at p~0.1, ${r30 && (r30 * 1000).toFixed(0)} mm at p 0.3`);
    if (r10 === null || r10 >= 0.05) problem(`s5: pan fill already ${r10 && (r10 * 1000).toFixed(0)} mm wide at p~0.1 (it should start as a mound)`);
    if (r30 === null || r30 < 0.0719) problem(`s5: pan fill only ${r30 && (r30 * 1000).toFixed(0)} mm wide at p 0.3 (it should reach the paper)`);
    const rel = await shot('s5-released');
    const sr = await state();
    if (rel.props.bowl) { const r = rel.props.bowl.screen; log.push(`s5-released: tilt ${sr.tilt !== undefined ? sr.tilt.toFixed(2) : '-'}, bowl on screen ${Math.round(r.x)}-${Math.round(r.x + r.w)} x ${Math.round(r.y)}-${Math.round(r.y + r.h)}`); }
    if (sr.step === s0.step && sr.phase !== 'done' && sr.bowlLevel < 0.0035) problem(`s5: the bowl snapped empty on letting go (level ${(sr.bowlLevel * 1000).toFixed(1)} mm)`);
    await page.waitForTimeout(150);
    {
      const pre = (await boxes()).props; // read before the (slow) screenshot
      const b = await shot('s5-after');
      if (!pre.bowl) problem('s5-after: no bowl 150 ms after done()');
    }
    // the bowl is tipped back and set down before the next Step
    let done = null, stepped = false;
    for (let i = 0; i < 600; i++) {
      const s = await state();
      // Step 6 only starts once the bowl's leave() has resolved, so a step change means it was set down
      // (a slow screenshot can let the short 'done' phase pass between polls).
      if (s.step !== s0.step) { stepped = true; break; }
      strays = Math.max(strays, s.strays || 0);
      if (s.phase === 'done') { done = s; break; }
      await page.waitForTimeout(15);
    }
    if (!done && stepped) { log.push('s5-done: step 6 began between polls; the set-down checks are skipped this run'); return; }
    if (!done) { problem('s5: never saw the bowl set down before step 6'); return; }
    await page.waitForTimeout(300); // the landing squash
    const b = await shot('s5-done');
    { const s2 = await state(); if (s2.phase === "done") done = s2; }
    log.push(`s5-done: bowl level ${(done.bowlLevel * 1000).toFixed(1)} mm opacity ${done.bowlOpacity.toFixed(2)}, pan level ${(done.panLevel * 1000).toFixed(1)} mm, collar lip ${(done.lip * 1000).toFixed(1)} mm, berries in the pan ${done.panBerries}, in the bowl ${done.bowlBerries}`);
    if (!done.surfVisible || Math.abs(done.bowlLevel - 0.003) > 0.0006 || done.bowlOpacity > 0.75) problem(`s5-done: the bowl should show a 3 mm see-through smear (level ${(done.bowlLevel * 1000).toFixed(1)} mm, opacity ${done.bowlOpacity.toFixed(2)}, shown ${done.surfVisible})`);
    if (done.bowlBerries > 0) problem(`s5-done: ${done.bowlBerries} berries still in the bowl`);
    if (flavor === 'blueberry' && done.panBerries < 8) problem(`s5-done: only ${done.panBerries} berries made it into the pan`);
    if (done.berryBodies > 0) problem(`s5-done: ${done.berryBodies} berry bodies still flying`);
    if (strays > 0) problem(`s5: ${strays} rigid bodies flew above 6 cm outside the pan and the bowl`);
    const pan = b.props.pan && b.props.pan.screen;
    if (pan) {
      panClip ??= { x: Math.max(0, Math.round(pan.x)), y: Math.max(0, Math.round(pan.y)), width: Math.round(Math.min(pan.w, viewport.width - pan.x)), height: Math.round(Math.min(pan.h, viewport.height - pan.y)) };
      panShots[aim] = await pixelsIn(panClip);
    }
  };
  const waitStep = (i, what) => page.waitForFunction((i) => window.__game.state().step === i, i, { timeout: 8000 }).catch(() => problem(`${what} did not complete`));
  const stepTitle = () => page.locator('#step-title').innerText();
  /** A one-finger swipe across the middle of the screen (dx < 0 turns toward the Stove), with real momentum at the end. */
  const swipe = async (dx) => {
    const y = viewport.height * 0.55;
    const x0 = viewport.width / 2 - dx / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 + (dx * i) / 12, y); await page.waitForTimeout(8); }
    await page.mouse.up();
  };

  const origin = `http://localhost:${server.address().port}`;
  const offOrigin = [];
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) offOrigin.push(u); });
  await page.goto(`${origin}/?fps`, { timeout: NAV_TIMEOUT, waitUntil: 'commit' });
  // Honest loading: the title is up (in Fredoka, from this origin) within 2 s, and Start is
  // pressed flat and faded until the Kitchen has drawn its first frame.
  {
    const t0 = Date.now();
    const titled = await page.waitForFunction(() => {
      const h = document.querySelector('#title h1');
      return !!h && h.getBoundingClientRect().height > 0 && document.fonts.check('600 20px Fredoka');
    }, null, { timeout: 2000, polling: 20 }).then(() => true).catch(() => false);
    log.push(`title with Fredoka after ${Date.now() - t0} ms`);
    if (!titled) problem('the title card was not up in Fredoka within 2 s');
    const early = await page.evaluate(() => { const b = document.getElementById('start'); return { disabled: b.disabled, opacity: Number(getComputedStyle(b).opacity) }; });
    log.push(`start early: disabled ${early.disabled}, opacity ${early.opacity}`);
    if (!early.disabled) problem('Start was already enabled before the kitchen loaded');
    else if (!(early.opacity < 1)) problem(`Start is disabled but fully opaque (${early.opacity})`);
  }
  await page.waitForFunction(() => window.__game && !document.getElementById('start').disabled, null, { timeout: 30000 });
  {
    const ready = await page.evaluate(() => ({ opacity: Number(getComputedStyle(document.getElementById('start')).opacity), seq: window.__loadingSeq || [], loading: document.getElementById('loading').textContent }));
    log.push(`loading lines: ${ready.seq.map((s) => JSON.stringify(s)).join(' -> ')}`);
    if (ready.opacity !== 1) problem(`Start is enabled but its opacity is ${ready.opacity}`);
    const want = ['warming up the oven…', 'rolling out the dough…', ''];
    if (want.some((w, i) => ready.seq.indexOf(w) < 0 || (i && ready.seq.indexOf(w) < ready.seq.indexOf(want[i - 1])))) problem(`#loading did not walk through ${want.map((w) => JSON.stringify(w)).join(' -> ')}`);
    if (ready.loading !== '') problem(`#loading still says "${ready.loading}" once Start is ready`);
    const links = await page.evaluate(() => ({ touch: !!document.querySelector('link[rel=apple-touch-icon]'), manifest: !!document.querySelector('link[rel=manifest]'), theme: document.querySelector('meta[name=theme-color]')?.getAttribute('content') }));
    if (!links.touch) problem('no link[rel=apple-touch-icon]');
    if (!links.manifest) problem('no link[rel=manifest]');
    if (links.theme !== '#fff6e9') problem(`theme-color is ${links.theme}`);
    for (const f of ['manifest.webmanifest', 'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'fonts/fredoka-400.woff2', 'fonts/fredoka-600.woff2', 'fonts/fredoka-700.woff2']) {
      if (!fs.existsSync(path.join(DIST, f))) problem(`dist/${f} is missing`);
    }
  }
  const cakes0 = (await state()).cakes;
  await page.click('#start');
  // A per-frame watcher for the feel of the flow: when the header and hint change (and that
  // they animate), the transition beats, the lining against its pip, the lumps and the whisk,
  // and the bowl around the end of step 5.
  await page.evaluate(() => {
    const g = window.__game;
    const w = (window.__t10 = { titleFit: [], titles: [], hints: [], trans: [], pipsEarly: 0, bowlAfter: null, bowlAt6: null, lumps: [], whiskDev: [], done: false, starts: [], acts: [] });
    const title = document.getElementById('step-title'), hint = document.getElementById('hint');
    const watch = (el, cls, list) => new MutationObserver(() => {
      const text = el.textContent;
      if (!text) return;
      const s = g.state();
      const rec = { text, transition: s.transition, settled: s.settled, phase: s.phase, anim: el.classList.contains(cls) };
      list.push(rec);
      if (!rec.anim) setTimeout(() => { rec.anim = el.classList.contains(cls); }, 100);
    }).observe(el, { childList: true, characterData: true, subtree: true });
    watch(title, 'pop', w.titles);
    new MutationObserver(() => {
      const text = title.textContent;
      if (text) setTimeout(() => w.titleFit.push({ text, sw: title.scrollWidth, cw: title.clientWidth }), 400);
    }).observe(title, { childList: true, characterData: true, subtree: true });
    watch(hint, 'swap', w.hints);
    let lastTr, lastStep = -1, lastAct;
    const tick = () => {
      const s = g.state();
      if (s.transition !== lastTr) { w.trans.push({ step: s.step, to: s.transition, time: s.time }); lastTr = s.transition; }
      // (a Step's debug numbers can carry their own "phase", so baking is "not idle and not the reveal")
      const baking = s.phase !== 'idle' && s.phase !== 'reveal';
      if (baking && s.step !== lastStep && s.step >= 0 && s.step < 6) w.starts.push({ step: s.step, time: s.time });
      lastStep = baking ? s.step : -1;
      if (s.cat.action !== lastAct) { w.acts.push({ action: s.cat.action, time: s.time, step: s.step }); lastAct = s.cat.action; }
      if (s.phase === 'baking' && s.step === 0 && document.querySelectorAll('#pips span.on').length === 1 && !(s.liningScale >= 0.99)) w.pipsEarly++;
      if (s.step === 1 && typeof s.lumps === 'number' && w.lumps[w.lumps.length - 1] !== s.lumps) w.lumps.push(s.lumps);
      if (s.step === 1 && s.stirSpeed > 3 && typeof s.whiskTilt === 'number') w.whiskDev.push(Math.abs(s.whiskTilt + 0.3));
      if (s.step === 4 && (s.transition === 'react' || s.transition === 'leave') && s.transitionT >= 0.2 && w.bowlAfter === null) w.bowlAfter = s.bowlY - s.bowlHomeY;
      if (s.step === 5 && w.bowlAt6 === null) w.bowlAt6 = s.bowlY - s.bowlHomeY;
      if (!w.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  // The sound watcher: every frame, the sounds the game logged that frame (tagged with the game
  // time, the Step and its stage at that frame) and the level of every running Loop, plus every
  // pointer down and up, so the sound can be checked against the physics after the run.
  await page.evaluate(() => {
    const g = window.__game;
    const w = (window.__snd = { events: [], samples: [], marks: [], downs: [], ups: [], last: null, chompStart: null, done: false, lastG: 0 });
    window.addEventListener('pointerdown', () => w.downs.push(performance.now()), true);
    window.addEventListener('pointerup', () => w.ups.push(performance.now()), true);
    const tick = () => {
      const s = g.state(), snd = g.sounds(), p = performance.now();
      // (a Step's debug numbers can carry their own "phase": out of the recipe is idle or the reveal)
      const out = s.phase === 'idle' || s.phase === 'reveal';
      const log = snd.log;
      const i = w.last ? log.lastIndexOf(w.last) : -1;
      // g is the game time of the frame that played it; gPrev the frame before (a sound can be no earlier than its frame)
      for (const e of log.slice(i + 1)) w.events.push({ ...e, g: s.time, gPrev: w.lastG, p, step: out ? -1 : s.step, item: s.itemName ?? null, bake: s.bakePhase ?? null });
      w.lastG = s.time;
      if (log.length) w.last = log[log.length - 1];
      w.samples.push({ p, g: s.time, step: out ? -1 : s.step, loops: snd.loops, holding: !!s.holding, progress: s.progress, streamActive: !!s.streamActive, item: s.itemName ?? null, bake: s.bakePhase ?? null });
      if (s.cat && s.cat.chompT !== null && w.chompStart === null) w.chompStart = s.time - s.cat.chompT;
      if (!w.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  /** A named moment on the page's clock, for windows in the sound checks. */
  const mark = (name) => page.evaluate((name) => { window.__snd.marks.push({ name, p: performance.now(), g: window.__game.state().time }); }, name);
  /** Every sound logged so far. */
  const sounds = () => page.evaluate(() => window.__snd.events);
  let sndCursor = 0;
  /** The sounds logged since the last call. */
  const sinceLast = async () => { const ev = await page.evaluate((c) => window.__snd.events.slice(c), sndCursor); sndCursor += ev.length; return ev; };
  /**
   * Check a set of sounds: each of `names` logged between min and max times (a number for
   * all, or { name: n }), and with order the first of each in that order.
   */
  const expectSounds = (label, events, { names, order = false, min = 1, max = Infinity }) => {
    const plays = events.filter((e) => !e.name.startsWith('loop:'));
    for (const name of names) {
      const n = plays.filter((e) => e.name === name).length;
      const lo = typeof min === 'object' ? (min[name] ?? 0) : min, hi = typeof max === 'object' ? (max[name] ?? Infinity) : max;
      if (n < lo || n > hi) problem(`${label} expected ${lo === hi ? lo : hi === Infinity ? `at least ${lo}` : `${lo}-${hi}`} ${name}, got ${n}`);
    }
    if (order) {
      let at = -1;
      for (const name of names) {
        const i = plays.findIndex((e, k) => k > at && e.name === name);
        if (i < 0) { problem(`${label}: ${name} missing from the order ${names.join(' > ')}`); break; }
        at = i;
      }
    }
  };
  /**
   * The sound of the whole run against what happened, once it is over: each Step's sounds
   * (counts, order, timing against the physics), every Loop's level against the hold, the
   * chomps against the cat's bites, the verdict's sting, and no name machine-gunning. Prints
   * the timeline.
   */
  const checkSounds = async () => {
    const w = await page.evaluate(() => { const w = window.__snd; w.done = true; return { events: w.events, samples: w.samples, marks: w.marks, downs: w.downs, ups: w.ups, chompStart: w.chompStart }; });
    const ev = w.events.filter((e) => !e.name.startsWith('loop:'));
    const inStep = (i) => ev.filter((e) => e.step === i);
    const lv = (x, name) => x.loops[name] ?? 0;
    const markAt = (name, after = -Infinity) => w.marks.find((m) => m.name === name && m.p >= after)?.p;
    /** The real pointer-up a mark (taken just after the mouse went up) belongs to. */
    const upFor = (p) => Math.max(-Infinity, ...w.ups.filter((u) => u <= p));
    const nextDown = (p) => Math.min(Infinity, ...w.downs.filter((d) => d > p));

    // The timeline: seconds on the audio clock from the first sound, the name, and the kind.
    {
      const t0 = w.events.length ? w.events[0].t : 0;
      const lines = [];
      for (let i = 0; i < w.events.length; i += 8) lines.push('  ' + w.events.slice(i, i + 8).map((e) => `${(e.t - t0).toFixed(2)} ${e.name} ${e.kind === 'sample' ? 'rec' : 'syn'}`).join(' | '));
      log.push(`sound timeline (${w.events.length} sounds; s from the first, rec = recorded take, syn = synthesized):\n${lines.join('\n')}`);
    }
    // Nothing machine-guns: no name more than 4 times in any 100 ms.
    {
      const byName = {};
      for (const e of ev) (byName[e.name] ??= []).push(e.t);
      for (const [name, ts] of Object.entries(byName)) {
        ts.sort((a, b) => a - b);
        for (let i = 4; i < ts.length; i++) if (ts[i] - ts[i - 4] < 0.1) { problem(`${name} logged 5 times within 100 ms`); break; }
      }
    }
    // Step 2: the whisk answers the circling within 300 ms; the sweet zone chimes once.
    {
      expectSounds('step 2', inStep(1), { names: ['chime'], min: 1, max: 1 });
      const down = markAt('stir-down');
      const first = w.samples.find((x) => x.p >= down && lv(x, 'whisk') > 0.3);
      const dt = first ? first.p - down : Infinity;
      log.push(`sound s2: whisk loop past 0.3 ${dt === Infinity ? 'never' : `${Math.round(dt)} ms`} after the stir began, up to ${Math.max(0, ...w.samples.filter((x) => x.step === 1).map((x) => lv(x, 'whisk'))).toFixed(2)}`);
      if (!(dt <= 300)) problem(`step 2: the whisk loop was not past 0.3 within 300 ms of circling (${dt === Infinity ? 'never' : Math.round(dt) + ' ms'})`);
    }
    // Step 3: three cracks, each yolk's plop 0.05-0.8 s after its crack, and the slow drag onto the rim taps.
    {
      const s3 = inStep(2);
      expectSounds('step 3', s3, { names: ['crack', 'plop'], min: 3, max: 3 });
      const cracks = s3.filter((e) => e.name === 'crack'), plops = s3.filter((e) => e.name === 'plop');
      const gaps = cracks.map((c, i) => (plops[i] ? plops[i].t - c.t : null));
      log.push(`sound s3: plops ${gaps.map((g) => (g === null ? '-' : `${g.toFixed(2)} s`)).join(', ')} after their cracks`);
      gaps.forEach((g, i) => { if (g !== null && (g < 0.05 || g > 0.8)) problem(`step 3: plop ${i + 1} came ${g.toFixed(2)} s after its crack (expected 0.05-0.8 s)`); });
      const r0 = markAt('rim-start'), r1 = markAt('rim-end', r0);
      const taps = ev.filter((e) => e.name === 'tap' && e.p >= r0 && e.p <= r1);
      log.push(`sound s3: ${taps.length} tap(s) on the slow drag onto the rim (gain ${taps.map((e) => e.gain).join(', ')})`);
      if (taps.length < 1) problem('step 3 expected at least 1 tap on a slow rim drag, got 0');
    }
    // Step 4: each pourable sounds the way it pours.
    {
      const items = w.marks.filter((m) => /^s4-.*-down$/.test(m.name)).map((m) => ({ name: m.name.slice(3, -5), down: m.p }));
      const s5start = w.samples.find((x) => x.step === 4)?.p ?? Infinity;
      items.forEach((it, i) => { it.up = upFor(markAt(`s4-${it.name}-up`, it.down)); it.end = items[i + 1]?.down ?? s5start; });
      for (const it of items) {
        const e = ev.filter((x) => x.p >= it.down && x.p < it.end);
        const sm = w.samples.filter((x) => x.p >= it.down && x.p < it.end);
        const label = `step 4 ${it.name}`;
        if (it.name === 'cream') {
          expectSounds(label, e, { names: ['splash', 'drip'], min: { splash: 2, drip: 1 }, max: { splash: 2, drip: 3 } }); // drops are heard only after the stream stops, 1-3 of them
          const early = sm.filter((x) => lv(x, 'pour') > 0 && !x.streamActive).length;
          const late = sm.filter((x) => x.p >= it.up + 300 && x.p < nextDown(it.up) && lv(x, 'pour') > 0).length;
          log.push(`sound ${label}: pour loop up to ${Math.max(0, ...sm.map((x) => lv(x, 'pour'))).toFixed(2)}, ${early} frame(s) before the stream, ${late} 300 ms after letting go; ${e.filter((x) => x.name === 'drip').length} drips`);
          if (!sm.some((x) => lv(x, 'pour') > 0)) problem(`${label}: the pour loop never sounded`);
          if (early) problem(`${label}: the pour loop sounded in ${early} frame(s) before the stream existed`);
          if (late) problem(`${label}: the pour loop still sounded ${late} frame(s) more than 300 ms after letting go`);
        } else if (it.name === 'flour') {
          expectSounds(label, e, { names: ['tink'] });
          if (!sm.some((x) => lv(x, 'flour') > 0)) problem(`${label}: the flour loop never sounded`);
        } else if (it.name === 'blueberries') {
          const plips = e.filter((x) => x.name === 'berry');
          const rates = new Set(plips.map((x) => x.rate.toFixed(2)));
          log.push(`sound ${label}: ${plips.length} plips at ${rates.size} different rates`);
          if (plips.length < 6) problem(`${label} expected at least 6 berry, got ${plips.length}`);
          if (rates.size < 3) problem(`${label}: the berry plips only use ${rates.size} pitch(es)`);
        } else if (it.name === 'lemon') {
          expectSounds(label, e, { names: ['lemon', 'drip'], min: { lemon: 2, drip: 1 } });
          if (sm.some((x) => lv(x, 'pour') > 0)) problem(`${label}: a pour loop sounded for the lemon`);
        }
      }
    }
    // Step 5: the glug only runs while the ring fills, and the bowl knocks down after.
    {
      const sm = w.samples.filter((x) => x.step === 4);
      let on = 0, bad = 0, lastOn = -Infinity;
      for (let i = 1; i < sm.length - 1; i++) {
        if (lv(sm[i], 'glug') <= 0) continue;
        on++;
        lastOn = sm[i].p;
        if (!(sm[i + 1].progress > sm[i - 1].progress)) bad++;
      }
      log.push(`sound s5: glug in ${on} frames, ${bad} of them with the ring standing still`);
      if (!on) problem('step 5: the glug loop never sounded');
      if (bad) problem(`step 5: the glug sounded in ${bad} frame(s) while the ring was not filling`);
      if (!inStep(4).some((e) => e.name === 'drop' && e.p > lastOn)) problem('step 5 expected a drop after the pour, got none');
    }
    // Step 6: the oven, beat by beat.
    {
      const s6 = inStep(5);
      expectSounds('step 6', s6, { names: ['grab', 'latch', 'door', 'rack', 'door', 'latch'], order: true });
      const wantChime = expect === 'under' ? 0 : 1, wantOver = expect === 'over' ? 1 : 0;
      expectSounds('step 6', s6, { names: ['bell', 'chime', 'over'], min: { bell: 1, chime: wantChime, over: wantOver }, max: { bell: 1, chime: wantChime, over: wantOver } });
      for (const c of s6.filter((e) => e.name === 'chime')) if (c.gain < 0.6) problem(`step 6: the burnt chime is only at gain ${c.gain}`);
      const bell = s6.findIndex((e) => e.name === 'bell');
      if (bell >= 0) expectSounds('step 6 after the bell', s6.slice(bell + 1), { names: ['latch', 'door', 'rack', 'drop'], order: true });
      const sm = w.samples.filter((x) => x.step === 5);
      let still = 0;
      for (let i = 1; i < sm.length - 1; i++) if (sm[i].bake === 'bake' && sm[i].holding && sm[i + 1].progress > sm[i - 1].progress && lv(sm[i], 'tick') <= 0) still++;
      if (still) problem(`step 6: the timer's tick was silent in ${still} frame(s) while the bake advanced`);
      const downs = w.marks.filter((m) => m.name === 's6-down');
      for (const { p: d, g: gd } of downs) {
        const up = upFor(markAt('s6-up', d));
        // the burner takes ~0.3 s of game time to roar up; a slow headless frame can stretch that past 800 ms of real time
        const held = sm.filter((x) => x.p >= d + 800 && x.g >= gd + 0.5 && x.p < up && x.holding);
        const low = held.filter((x) => lv(x, 'oven') < 0.9).length;
        const after = sm.find((x) => x.p >= up + 300);
        const tickLate = sm.filter((x) => x.p >= up + 100 && x.p < nextDown(up) && lv(x, 'tick') > 0).length;
        log.push(`sound s6: a hold of ${Math.round(up - d)} ms: oven ${held.length ? Math.min(...held.map((x) => lv(x, 'oven'))).toFixed(2) : '-'}+ while held, ${after ? lv(after, 'oven').toFixed(2) : '-'} 300 ms after; tick on ${tickLate} frame(s) 100 ms after`);
        if (low) problem(`step 6: the oven loop under 0.9 in ${low} frame(s) of a hold`);
        if (after && lv(after, 'oven') > 0.4) problem(`step 6: the oven loop still at ${lv(after, 'oven').toFixed(2)} 300 ms after letting go`);
        if (tickLate) problem(`step 6: the timer still ticked ${tickLate} frame(s) more than 100 ms after letting go`);
      }
    }
    // Every Loop falls silent within 300 ms of any finger lifting (the oven to its idle hum).
    {
      const loud = new Map();
      for (const u of w.ups) {
        if (nextDown(u) <= u + 350) continue;
        const x = w.samples.find((s) => s.p >= u + 300);
        if (!x) continue;
        for (const [name, l] of Object.entries(x.loops)) if (name === 'oven' ? l > 0.4 : l > 0) loud.set(name, Math.max(loud.get(name) ?? 0, l));
      }
      for (const [name, l] of loud) problem(`loop ${name} still at ${l.toFixed(2)} 300 ms after a pointer-up`);
    }
    // The taste test: a chomp on each of the three bites, one gulp, the verdict's sting.
    {
      const bites = [0.224, 0.449, 0.673]; // CHOMP.bites in cat.ts
      const ch = ev.filter((e) => e.name === 'chomp');
      if (ch.length !== 3) problem(`expected 3 chomp, got ${ch.length}`);
      else if (w.chompStart === null) problem('never saw the chomp start');
      else {
        // On time is within 40 ms of the bite, or in the very frame the bite falls in (a headless
        // frame that stalls on a screenshot can be longer than 40 ms; the game cannot sound earlier).
        const offs = ch.map((c, i) => { const want = w.chompStart + bites[i]; return { o: c.g - want, inFrame: c.gPrev < want + 1e-6 && want <= c.g + 1e-6 }; });
        log.push(`sound chomps: ${offs.map(({ o, inFrame }) => `${(o * 1000).toFixed(0)} ms${inFrame ? ' (its frame)' : ''}`).join(', ')} from the bites`);
        offs.forEach(({ o, inFrame }, i) => { if (Math.abs(o) > 0.04 && !inFrame) problem(`chomp ${i + 1} is ${(o * 1000).toFixed(0)} ms off its bite`); });
      }
      expectSounds('the taste test', ev.filter((e) => e.step === -1), { names: ['gulp'], min: 1, max: 1 });
      const from = ch.length ? ch[ch.length - 1].p : Infinity, to = markAt('shelf') ?? Infinity;
      const sting = ev.filter((e) => e.p > from && e.p < to);
      const want = { right: ['cheer', 'pop'], under: ['meh'], over: ['over'] }[expect];
      const not = { right: ['over', 'chime', 'meh'], under: ['cheer', 'over', 'chime'], over: ['cheer', 'chime', 'meh'] }[expect];
      log.push(`sound verdict: ${sting.map((e) => e.name).join(', ')}`);
      expectSounds(`the ${expect} verdict`, sting, { names: want, order: true });
      expectSounds(`the ${expect} verdict`, sting, { names: not, min: 0, max: 0 });
    }
  };

  // The recordings: every name in the manifest must have decoded.
  {
    const file = path.join(__dirname, '..', 'public', 'sounds', 'manifest.json');
    const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    if (!manifest) problem('samples not loaded (public/sounds/manifest.json is missing)');
    else {
      const want = [...Object.keys(manifest).filter((k) => k !== 'loops'), ...Object.keys(manifest.loops || {})];
      let have = [];
      for (let k = 0; k < 100; k++) {
        have = (await page.evaluate(() => window.__game.sounds().loaded)).map((l) => l.name);
        if (want.every((n) => have.includes(n))) break;
        await page.waitForTimeout(100);
      }
      const missing = want.filter((n) => !have.includes(n));
      log.push(`samples loaded: ${have.length} of ${want.length} manifest names`);
      if (missing.length) problem(`samples not loaded: ${missing.join(', ')}`);
    }
  }
  await page.waitForTimeout(900);
  await shot('idle');
  {
    const chev = await page.evaluate(() => window.__game.chevrons());
    const cr = await page.evaluate(() => window.__game.cueRect());
    const tb = (await page.evaluate(() => window.__game.targets())).book;
    log.push(`idle: chevrons ${chev}, book cue ${cr ? `${Math.round(cr.x + cr.w / 2)},${Math.round(cr.y + cr.h / 2)}` : null}, book ${tb && `${Math.round(tb.x)},${Math.round(tb.y)}`}`);
    if (!chev) problem('no swipe chevrons on the first idle visit');
    if (!cr) problem('no finger cue on the book at idle');
    else if (tb && Math.hypot(cr.x + cr.w / 2 - tb.x, cr.y + cr.h / 2 - tb.y) > 30) problem('the idle finger cue is not on the book');
  }

  // The rail: a Station hop is a 0.7 s timeline with an honest settle, never a snap.
  {
    await page.evaluate(() => window.__game.goTo('stove'));
    const t0 = Date.now();
    let settledAt = null;
    while (Date.now() - t0 < 1500 && settledAt === null) {
      if ((await state()).settled) settledAt = Date.now() - t0;
      else await page.waitForTimeout(25);
    }
    const s = await state();
    if (settledAt === null) problem('rail never settled after goTo stove');
    else if (settledAt < 450) problem(`rail settled ${settledAt} ms after goTo: too quick to be a 0.7 s move`);
    else if (settledAt > 1000) problem(`rail took ${settledAt} ms to settle after goTo`);
    if (s.station !== 'stove') problem(`goTo stove left the station at ${s.station}`);
    if (s.railMaxStepDx >= 0.004) problem(`rail jumped ${s.railMaxStepDx.toFixed(4)} m in one frame`);
    log.push(`rail: counter -> stove settled in ${settledAt} ms, max jump ${s.railMaxStepDx.toFixed(4)}`);
    await shot('idle-stove');
    // The counter just in front of the oven, right of the pan's slot: the oven's light must never reach it.
    const c = await page.evaluate(([x, y, z]) => window.__game.screenOf(x, y, z), COUNTER_SPOT);
    idleCounter = await pixelAt(c.x, c.y);
    log.push(`counter by the oven, idle: ${idleCounter.join(',')}`);
  }
  // Swiping while idle turns between Stations: one swipe, one Station.
  for (const [dx, expect] of [[300, 'counter'], [300, 'fridge'], [-300, 'counter'], [-300, 'stove'], [300, 'counter']]) {
    await sinceLast();
    await swipe(dx);
    await settle();
    const s = await state();
    if (s.station !== expect) problem(`idle swipe of ${dx} px reached ${s.station}, expected ${expect}`);
    if (await page.evaluate(() => window.__game.chevrons())) problem(`the swipe chevrons still show after an idle swipe to the ${expect}`);
    // one swipe, one swoosh (and no thud as the view lands)
    expectSounds(`idle swipe to the ${expect}`, await sinceLast(), { names: ['swoosh', 'drop'], min: { swoosh: 1, drop: 0 }, max: { swoosh: 1, drop: 0 } });
    if (expect === 'fridge') await shot('idle-fridge');
  }
  log.push('idle swipes: stove -> counter -> fridge -> counter -> stove -> counter');

  let t = await targets('idle');
  await sinceLast();
  await page.mouse.click(t.book.x, t.book.y);
  await page.waitForTimeout(300);
  if (!(await page.locator('#book').isVisible())) problem('tapping the book did not open it');
  await shot('book');
  await page.locator('#book-flavors .chip', { hasText: flavor.charAt(0).toUpperCase() + flavor.slice(1) }).click();
  await page.click('#book-bake');
  await page.waitForTimeout(500);
  // the book opens and shuts with a page sound; the chip clicks
  expectSounds('the recipe book', await sinceLast(), { names: ['book', 'chip'], min: { book: 2, chip: 1 } });

  // Step 1: line the pan.
  await settle();
  log.push('step 1: ' + (await stepTitle()));
  await cueOn('s1-start');
  {
    const hints = await page.evaluate(() => window.__game.stepHints());
    for (const h of hints) if (!HINT_RE.test(h)) problem(`step hint "${h}" does not start with a gesture`);
    log.push(`hints: ${hints.join(' / ')}`);
  }
  t = await targets('step 1');
  {
    const b = await shot('s1-start');
    const c = b.props.cat && b.props.cat.screen;
    if (c && (c.x < 0 || c.y < 0 || c.x + c.w > viewport.width)) problem(`the cat's head is cut off at s1-start (${Math.round(c.x)},${Math.round(c.y)})`);
    const cr = await page.evaluate(() => window.__game.cueRect());
    const sh = b.props.sheet && b.props.sheet.screen;
    if (!cr) problem('no finger cue drawn at s1-start');
    else if (sh && !(cr.x + cr.w / 2 > sh.x && cr.x + cr.w / 2 < sh.x + sh.w && cr.y + cr.h / 2 > sh.y && cr.y + cr.h / 2 < sh.y + sh.h)) problem(`the finger cue is not on the parchment at s1-start`);
  }
  // A swipe mid-Step is a Nudge: the view tugs a little and comes straight back to the Station.
  {
    const y = viewport.height * 0.55;
    const x0 = viewport.width / 2 + 150;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) { await page.mouse.move(x0 - (300 * i) / 12, y); await page.waitForTimeout(8); }
    await shot('s1-swipe');
    await page.mouse.up();
    await settle();
    const s = await state();
    if (s.station !== 'counter' || s.step !== 0) problem(`a swipe mid-step moved the game to ${s.station} / step ${s.step}`);
    const after = await targets('after the mid-step swipe');
    if (!after.sheet) problem('no sheet target after the mid-step swipe');
    if (!(await page.locator('#hint').isVisible())) problem('the hint is gone after the mid-step swipe');
    await shot('s1-swipe-back');
    t = after;
  }
  {
    // Carry the sheet over in 18 steps; halfway the sheet must lean into its travel.
    const from = t.sheet, to = t.pan;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    let lean = 0; // the most it leaned over the middle of the drag (the lean sways, so one sample can catch it passing upright)
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / 18, from.y + ((to.y - from.y) * i) / 18);
      await page.waitForTimeout(16);
      if (i >= 5 && i <= 9) { const s = await state(); lean = Math.max(lean, s.carry ? Math.abs(s.carry.lean) : 0); }
      if (i === 9) {
        await cueOff('s1-dragging');
        log.push(`s1: lean mid-drag ${lean.toFixed(3)} rad`);
        if (!(lean > 0.12)) problem(`s1: the sheet barely leans mid-drag (${lean.toFixed(3)} rad)`);
        await shot('s1-dragging');
      }
    }
    await page.waitForTimeout(120);
    await page.mouse.up();
    const upAt = (await state()).time;
    await page.waitForTimeout(100);
    await shot('s1-dropped');
    const doneAt = await waitDone(0, 'step 1 (line the pan)');
    if (doneAt !== null) {
      log.push(`s1: done ${(doneAt - upAt).toFixed(2)} s after the drop`);
      if (doneAt - upAt > 1.6) problem(`s1: done ${(doneAt - upAt).toFixed(2)} s after the drop (more than 1.6 s)`);
    }
    await page.waitForTimeout(150);
    const pre = (await boxes()).props; // read before the (slow) screenshot
    const b = await shot('s1-after');
    const s = await state();
    log.push(`s1: biggest per-frame turn of a prop ${s.maxRotDelta.toFixed(3)} rad`);
    if (!(s.maxRotDelta < 0.25)) problem(`s1: a prop turned ${s.maxRotDelta.toFixed(3)} rad in one frame (drag and drop)`);
    if (!pre.pan) problem('s1-after: the pan is gone 150 ms after done()');
    // The crinkled lining must fit inside the ring (x and z; it rises above it on purpose).
    const lining = b.props.lining, ring = b.props.ring;
    if (!lining || !ring) problem('lining or ring missing at s1-after');
    else {
      for (const i of [0, 2]) if (lining.world.min[i] < ring.world.min[i] || lining.world.max[i] > ring.world.max[i]) problem(`lining pokes through the ring (axis ${i === 0 ? 'x' : 'z'})`);
    }
    const early = await page.evaluate(() => window.__t10.pipsEarly);
    if (early > 0) problem(`s1: the pip filled ${early} frame(s) before the lining had bloomed`);
  }
  await waitStep(1, 'step 1 (line the pan)');

  // Step 2: stir.
  await settle();
  log.push('step 2: ' + (await stepTitle()));
  await cueOn('s2-start');
  t = await targets('step 2');
  await shot('s2-start');
  {
    // Tapping the cat mid-stir is a Nudge: it counts, and nothing stirs.
    const n0 = (await state()).nudges;
    await page.mouse.click(t.cat.x, t.cat.y);
    await page.waitForTimeout(120);
    const s = await state();
    log.push(`s2: tapped the cat: nudges ${n0} -> ${s.nudges}, progress ${s.progress.toFixed(3)}`);
    if (s.nudges !== n0 + 1) problem(`tapping the cat during the stir was not a Nudge (nudges ${n0} -> ${s.nudges})`);
    if (s.progress > 0) problem(`tapping the cat stirred (progress ${s.progress.toFixed(3)})`);
    await shot('s2-nudge-cat');
  }
  {
    // Both paws in frame: the pixel at each paw is fur, not counter or wall.
    for (const paw of ['pawL', 'pawR']) {
      const px = await pixelAt(t[paw].x, t[paw].y);
      log.push(`${paw} pixel rgb(${px.join(',')})`);
      if (!furLike(px)) problem(`${paw} not visible at s2-start (pixel rgb(${px.join(',')}))`);
    }
  }
  {
    const c = t.bowl; const r = 70;
    let a = 0;
    await page.mouse.move(c.x + r, c.y);
    await mark('stir-down');
    await page.mouse.down();
    for (let i = 0; i < 400; i++) {
      a += 0.38;
      await page.mouse.move(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.7);
      await page.waitForTimeout(14);
      if (i === 12) await cueOff('s2-stirring');
      if (i % 6 === 0 && (await progress()) >= 0.7) break;
    }
    await shot('s2-stirring');
    await ringCheck('s2-stirring');
    log.push(`s2: stirred to p=${(await progress()).toFixed(2)}`);
    await page.mouse.up();
    await waitDone(1, 'step 2 (stir)');
    await page.waitForTimeout(150);
    const pre = (await boxes()).props; // read before the (slow) screenshot
    const b = await shot('s2-after');
    if (!pre.whisk) problem('s2-after: the whisk is gone 150 ms after done()');
    const w = await page.evaluate(() => window.__t10);
    const drops = w.lumps.filter((v, i) => i > 0 && v < w.lumps[i - 1]).length;
    const dev = w.whiskDev;
    const leaning = dev.filter((d) => d > 0.15).length;
    log.push(`s2: lumps ${w.lumps.join(' > ')} (${drops} pops); whisk off its rest tilt by > 0.15 rad in ${leaning} of ${dev.length} fast frames (max ${dev.length ? Math.max(...dev).toFixed(2) : '-'})`);
    if (drops < 4) problem(`s2: the lumps went in ${drops} step(s), not one by one (${w.lumps.join(' > ')})`);
    if (!dev.length) problem('s2: never saw the whisk going fast (speed > 3)');
    else if (leaning < dev.length * 0.25) problem(`s2: the whisk hardly leans while stirring fast (${leaning} of ${dev.length} frames off its rest tilt by > 0.15 rad)`);
  }
  await waitStep(2, 'step 2 (stir)');

  // Step 3: eggs. The pan is parked off screen: the carton has the front slot to itself.
  await settle();
  log.push('step 3: ' + (await stepTitle()));
  await cueOn('s3-start');
  await shot('s3-start');
  for (let i = 0; i < 3; i++) {
    t = await targets(`step 3 egg ${i}`, ['pan']);
    panClear(t, `step 3 egg ${i}`);
    const egg = t[`egg${i}`];
    await page.mouse.move(egg.x, egg.y);
    await page.mouse.down();
    if (i === 0) await cueOff('s3-egg0');
    if (i === 0) {
      // Carried straight at the bowl (to just outside its rim), the egg leans toward it.
      const w = t.toward0;
      for (let k = 1; k <= 20; k++) {
        await page.mouse.move(egg.x + ((w.x - egg.x) * k) / 20, egg.y + ((w.y - egg.y) * k) / 20);
        await page.waitForTimeout(12);
        if (k === 10) {
          const d = await state();
          log.push(`s3: egg lean on the way to the bowl ${d.eggLean.toFixed(3)} rad, ${d.eggToward.toFixed(3)} of it toward the bowl`);
          // carried toward the bowl, the egg leans into its travel: its top tips that way
          if (!(d.eggToward > 0.03)) problem(`s3: the egg does not lean toward the bowl on the way (${d.eggToward.toFixed(3)} rad)`);
          await shot('s3-moving');
        }
      }
      await page.waitForTimeout(150);
    }
    await page.mouse.move(t.outside.x + i * 10, t.outside.y, { steps: 20 });
    await page.waitForTimeout(200);
    if (i === 0) {
      // A slow drag onto the rim: the egg comes down and rests on it (a tap, no crack), then back out.
      await mark('rim-start');
      for (let k = 1; k <= 24; k++) {
        await page.mouse.move(t.outside.x + ((t.rim.x - t.outside.x) * k) / 24, t.outside.y + ((t.rim.y - t.outside.y) * k) / 24);
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(400);
      const d = await state();
      log.push(`s3: egg resting on the rim, its underside ${d.eggOverRim === null ? '-' : (d.eggOverRim * 1000).toFixed(1) + ' mm'} over the rim's top, ${d.cracked} cracked`);
      if (d.eggOverRim === null || d.eggOverRim > 0.004 || d.eggOverRim < -0.003) problem(`s3: the egg dragged onto the rim is not touching it (${d.eggOverRim === null ? 'not over it' : (d.eggOverRim * 1000).toFixed(1) + ' mm over its top'})`);
      if (d.cracked > 0) problem('s3: a slow drag onto the rim cracked the egg');
      await shot('s3-crack'); // the egg at rim height, on the rim, about to be knocked
      for (let k = 1; k <= 12; k++) {
        await page.mouse.move(t.rim.x + ((t.outside.x - t.rim.x) * k) / 12, t.rim.y + ((t.outside.y - t.rim.y) * k) / 12);
        await page.waitForTimeout(25);
      }
      await page.waitForTimeout(250);
      await mark('rim-end');
    }
    await page.mouse.move(t.inside.x + i * 10, t.inside.y, { steps: 2 });
    await page.waitForTimeout(120);
    if (i === 0) await shot('s3-knock');
    await page.mouse.up();
    if (i < 2) await page.waitForTimeout(700);
  }
  await waitDone(2, 'step 3 (eggs)');
  await page.waitForTimeout(150);
  {
    const pre = (await boxes()).props; // read before the (slow) screenshot
    const b = await shot('s3-after');
    if (!pre.carton) problem('s3-after: the carton is gone 150 ms after done()');
  }
  await shot('s3-done');
  await waitStep(3, 'step 3 (eggs)');

  // Steps 4 and 5 run at quarter speed so the holding shots land mid-pour.
  await slowmo(4);

  // Step 4: pour cream, flour, add-in. One pourable at a time, still no pan.
  await settle();
  log.push('step 4: ' + (await stepTitle()));
  await cueOn('s4-start');
  await shot('s4-start');
  for (let i = 0; i < 4; i++) {
    const s = await state();
    if (s.step !== 3 || !s.stage || s.stage === 'done') break; // the last vessel is leaving (or gone); the Step index moves on after that
    // Each vessel arrives and sits upright at the front slot before it is picked up.
    const ok = await page.waitForFunction((i) => { const s = window.__game.state(); return s.step === 3 && s.item === i && s.itemState === 'active' && s.vesselPhase === 'rest' && !s.holding; }, i, { timeout: 8000 }).then(() => true).catch(() => false);
    if (!ok) { problem(`step 4 item ${i} never settled at the front slot`); break; }
    await shot(`s4-item${i}-settled`);
    {
      const d = await state();
      if (d.vesselRot > 1e-4) problem(`s4-item${i}-settled: a vessel is not upright (|rotation| ${d.vesselRot.toFixed(4)})`);
    }
    t = await targets(`step 4 item ${i}`, ['pan']);
    if (!t.item) break;
    panClear(t, `step 4 item ${i}`);
    await pourHold(t.item, 0.68, `s4-item${i}`, i);
    if (i === 0) await cueOff('s4-item0');
    await page.waitForTimeout(700);
  }
  {
    // fps is noisy headless; average a few readings
    let sum = 0;
    for (let k = 0; k < 10; k++) { sum += (await state()).fps; await page.waitForTimeout(50); }
    log.push('fps after step 4: ' + (sum / 10).toFixed(1));
  }

  // Step 4 -> 5: the pan slides back in from the right (0.5 s at full speed). Catch it on
  // the way: poll until its centre has crossed into the frame, then shoot right away.
  await slowmo(1);
  await waitStep(4, 'step 4 (pour)');
  let midPan = null;
  for (let i = 0; i < 100 && !midPan; i++) {
    const p = (await page.evaluate(() => window.__game.targets())).pan;
    if (p && p.x < viewport.width * 0.85) midPan = p;
    else await page.waitForTimeout(15);
  }
  await shot('s4to5-transition');
  await page.waitForFunction(() => window.__game.state().panArrived, null, { timeout: 4000 }).catch(() => problem('the pan never arrived for step 5'));
  await slowmo(4);

  // Step 5: pour into the pan.
  await settle();
  log.push('step 5: ' + (await stepTitle()));
  await cueOn('s5-start');
  t = await targets('step 5');
  {
    const b = await shot('s5-start');
    if (!b.props.pan) problem('no pan at s5-start');
    for (const name of ['jug', 'cup', 'dish', 'lemon']) if (b.props[name]) problem(`${name} still out at s5-start`);
    if (Math.abs(t.pan.x - viewport.width / 2) > 40) problem(`pan not centred at s5-start (x=${Math.round(t.pan.x)})`);
    if (!midPan || !(midPan.x > t.pan.x + 40)) problem(`pan did not slide in from the right (mid x=${midPan && Math.round(midPan.x)}, final x=${Math.round(t.pan.x)})`);
    log.push(`pan slid in: x ${midPan && Math.round(midPan.x)} -> ${Math.round(t.pan.x)}`);
  }
  {
    // the pink seam (the "just right" fill line) shows on the back of the collar
    // the line is ~4 px thick: take the pinkest of a few pixels across it
    let px = [0, 0, 0];
    for (const dy of [-3, -1.5, 0, 1.5, 3]) {
      const q = await pixelAt(t.seam.x, t.seam.y + dy);
      if (q[0] - q[1] > px[0] - px[1]) px = q;
    }
    log.push(`seam pixel ${px.join(',')}`);
    if (!(px[0] - px[1] > 25 && px[0] > 170)) problem(`fill line not visible at s5-start (pixel ${px.join(',')} at the seam)`);
  }
  await pourPanHold(t.bowl, expect === 'under' ? 0.4 : expect === 'over' ? 0.95 : 0.7);
  await cueOff('s5-poured');
  await waitStep(5, 'step 5 (pour into pan)');
  await slowmo(1);
  // From here to the reveal a per-frame watcher keeps an eye on the door and the pan.
  await page.evaluate(() => {
    const w = (window.__watch = { doorMax: 0, doorAtChange: null, lastStep: 5, track: false, gapFrames: 0, maxGapMs: 0, minDoorGap: Infinity, slidingFrames: 0, done: false });
    let last = performance.now(), gapStart = null;
    const tick = () => {
      const g = window.__game, s = g.state(), now = performance.now();
      const door = g.probe().doorOpen * 1.5; // probe reports rotation / 1.5
      w.doorMax = Math.max(w.doorMax, door);
      if (w.lastStep === 5 && s.step !== 5) w.doorAtChange = door;
      w.lastStep = s.step;
      if (s.bakePhase === 'opening') w.track = true;
      if (w.track) {
        const t = g.targets();
        if (!t.pan && !t.cake) { w.gapFrames++; gapStart ??= last; w.maxGapMs = Math.max(w.maxGapMs, now - gapStart); }
        else gapStart = null;
        if (t.cake) w.track = false;
      }
      if ((s.bakePhase === 'sliding-out' || s.bakePhase === 'resting') && s.doorGap !== null && s.doorGap !== undefined) { w.minDoorGap = Math.min(w.minDoorGap, s.doorGap); w.slidingFrames++; }
      last = now;
      if (!w.done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  {
    // The cat's line pops up at the Stove within a second of the Step starting.
    let seen = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 1000 && !seen) {
      const p = await page.evaluate(() => window.__game.probe());
      if (p.bubbleVisible) seen = true; else await page.waitForTimeout(40);
    }
    if (!seen) problem('no cat bubble within 1 s of step 6 starting');
  }

  // Step 6: bake at the stove. The pan slides in from the Stove's park slot.
  await settle();
  await page.waitForFunction(() => window.__game.state().panArrived, null, { timeout: 4000 }).catch(() => problem('the pan never arrived at the stove'));
  log.push('step 6: ' + (await stepTitle()) + ' / station ' + (await state()).station);
  await cueOn('s6-start');
  {
    // The Stove pose puts the oven door at the centre of the screen, with the pan in front of it.
    const b = await shot('s6-stove');
    catInside(b, 's6-stove');
    const d = b.props.ovenDoor && b.props.ovenDoor.screen;
    if (!d) problem('no oven door at s6-stove');
    else {
      const off = Math.hypot(d.x + d.w / 2 - viewport.width / 2, d.y + d.h / 2 - viewport.height / 2);
      if (off > 40) problem(`oven door centre is ${Math.round(off)} px off the screen centre at s6-stove`);
      log.push(`oven door centre ${Math.round(off)} px from the screen centre`);
    }
    const o = b.props.oven && b.props.oven.screen;
    if (o) {
      log.push(`oven at s6-stove: top ${Math.round(o.y)} px, header ${b.hud.stepHead ? Math.round(b.hud.stepHead.y + b.hud.stepHead.h) : '-'} px`);
      if (o.y < 0) problem(`the oven's top is cut off at s6-stove (${Math.round(o.y)} px)`);
      if (rectsCross(o, b.hud.stepHead)) problem('the oven runs under the step header at s6-stove');
    }
    if (!(await page.evaluate(() => window.__game.probe())).catOnScreen) problem('the cat is not on screen at the Stove (s6-stove)');
    const m = await page.evaluate(() => window.__game.meter());
    if (!m || (m.sweet[1] - m.sweet[0]) * m.duration < 1.5) problem(`the bake's sweet window is too short (${m && ((m.sweet[1] - m.sweet[0]) * m.duration).toFixed(2)} s)`);
  }
  t = await targets('step 6');
  {
    // Pick the pan up: the door falls open flat, like a shelf, and bounces once on its stop.
    await page.mouse.move(t.pan.x, t.pan.y);
    await page.mouse.down();
    await page.waitForTimeout(60);
    await page.mouse.move(t.pan.x, t.pan.y - 30, { steps: 5 });
    await cueOff('s6-pan');
    await page.waitForTimeout(700);
    const d = await state();
    log.push(`s6: door at ${d.doorAngle.toFixed(3)} rad while the pan is held`);
    if (!(d.doorAngle >= 1.5 && d.doorAngle <= 1.7)) problem(`oven door at ${d.doorAngle.toFixed(2)} rad while the pan is held (expected it lying open, 1.5-1.7)`);
    // Carry it over the open door and let go anywhere there.
    await page.mouse.move(t.ovenMouth.x, t.ovenMouth.y, { steps: 25 });
    await page.waitForTimeout(150);
    await shot('s6-door-open-hover');
    await page.mouse.up();
  }
  {
    const ok = await page.waitForFunction(() => window.__game.state().bakePhase === 'sliding', null, { timeout: 3000 }).then(() => true).catch(() => false);
    if (!ok) problem(`dropping the pan over the open door did not start the slide (phase ${(await state()).bakePhase})`);
    else await shot('s6-sliding');
  }
  {
    // The door shuts only once the pan is on the rack; then the view leans in to the window.
    const ok = await page.waitForFunction(() => window.__game.state().bakePhase === 'bake', null, { timeout: 4000 }).then(() => true).catch(() => false);
    if (!ok) problem(`the bake never started (phase ${(await state()).bakePhase})`);
    await page.waitForTimeout(1200); // the lean-in starts this frame; settled can still read true from the door pose
    await settle();
    const b = await shot('s6-in-oven');
    // Read the cat and its bubble at the shot, before the slower pixel checks (the line lasts 3.5 s).
    const pr = await page.evaluate(() => window.__game.probe());
    await counterCheck('s6-in-oven');
    const d = await state();
    const head = b.hud.stepHead;
    // The window is the glass door (its frame and pane); the pane alone must clear the header.
    const frac = d.window.h / viewport.height;
    log.push(`s6-in-oven: window ${Math.round(d.window.y)}-${Math.round(d.window.y + d.window.h)} px (${(frac * 100).toFixed(0)}% of the screen; the pane ${Math.round(d.glass.y)}-${Math.round(d.glass.y + d.glass.h)}), header bottom ${head ? Math.round(head.y + head.h) : '-'}, door ${d.doorAngle}`);
    // (backed off a touch from the glass so the cat on the oven stays in the view: 30%, not 38%)
    if (tag === 'phone' && frac < 0.3) problem(`the oven window is only ${(frac * 100).toFixed(0)}% of the screen height at s6-in-oven`);
    if (head && d.window.y < head.y + head.h) problem(`the window's top (${Math.round(d.window.y)} px) is under the header (${Math.round(head.y + head.h)} px) at s6-in-oven`);
    if (d.doorAngle !== 0) problem(`the door is not shut while baking (${d.doorAngle})`);
    const tt = await page.evaluate(() => window.__game.targets());
    const px = tt.top ? await pixelAt(tt.top.x, tt.top.y) : null;
    log.push(`s6-in-oven: batter through the glass ${px && px.join(',')}`);
    // raw batter is cream, or lilac for blueberry (it only bakes toward the stage colours by golden)
    const rawBatter = (c) => c[0] >= 150 && (c[0] - c[2] >= 25 || (flavor === 'blueberry' && c[2] >= 125 && c[0] - c[1] >= 8));
    if (!px || !rawBatter(px)) problem(`no pale batter disc through the glass at s6-in-oven (${px && px.join(',')})`);
    if (!pr.catOnScreen) problem('the cat is off screen at s6-in-oven');
    if (!pr.bubbleVisible) problem('no cat bubble at s6-in-oven');
  }
  t = await targets('step 6 in oven');
  const until = aim === 'under' ? 0.45 : aim === 'over' ? 0.92 : aim === 'timeout' ? 1.01 : 0.72;
  const endHex = await bakeHold(t.anywhere, until);
  // The beats out of the oven are short (0.5-2.2 s) and a desktop screenshot can take most of
  // a second headless, so the driver watches them at a third of the speed, up to reveal-arrive.
  await slowmo(3);
  {
    // Out it comes: the door drops, steam rolls out, the pan slides out onto the door.
    const ok = await page.waitForFunction(() => ['opening', 'sliding-out'].includes(window.__game.state().bakePhase), null, { timeout: 3000 }).then(() => true).catch(() => false);
    if (!ok) problem('the door never opened after the bake');
    await page.waitForTimeout(150);
    await shot('s6-opening');
    const d = await state();
    if (!(d.steam > 0)) problem('no steam out of the open door');
    if (aim === 'timeout') {
      const text = await page.locator('#bubble').innerText();
      if (!/phew/i.test(text)) problem(`the cat did not call time when the dial ran out ("${text}")`);
    }
    const ok2 = await page.waitForFunction(() => window.__game.state().bakePhase === 'sliding-out', null, { timeout: 3000 }).then(() => true).catch(() => false);
    if (!ok2) problem('the pan never slid out');
    else {
      await page.waitForTimeout(200);
      const b = await shot('s6-sliding-out');
      const so = await state();
      const door = b.props.ovenDoor, pan = b.props.pan;
      // Sliding out, the pan may only touch the door from above (on its top face), never pass through it.
      if (door && pan && boxesCross(door, pan) && (so.doorGap === null || so.doorGap < -0.001)) problem(`the pan passes through the oven door while sliding out (gap ${so.doorGap})`);
    }
  }
  {
    const ok = await page.waitForFunction(() => window.__game.state().bakePhase === 'resting', null, { timeout: 3000 }).then(() => true).catch(() => false);
    if (!ok) problem('the pan never came to rest on the door');
    // Back to full speed for the 2.2 s rest, so the view has backed off from the window when it is shot.
    await slowmo(1);
    await settle();
    await shot('s6-resting');
    const want = { right: /BURNT TOP/i, under: /Golden/i, over: /Charred/i }[expect];
    const tagEl = page.locator('#tag');
    const text = (await tagEl.isVisible()) ? await tagEl.innerText() : '';
    log.push(`s6-resting: tag "${text}"`);
    if (!want.test(text)) problem(`#tag does not name the stage at s6-resting ("${text}")`);
    const d = await state();
    if (d.doorGap === null) problem('the pan is not on the open door at s6-resting');
    if (!(await page.evaluate(() => window.__game.probe())).catOnScreen) problem('the cat is off screen at s6-resting');
  }
  // One continuous ride to the reveal: the pan never vanishes before the cake is there.
  await slowmo(3);
  await page.waitForFunction(() => window.__game.state().phase === 'reveal', null, { timeout: 30000 }).catch(() => problem('bake did not reach the reveal')); // the beats run 3x slowed here
  {
    const ok = await page.waitForFunction(() => !!window.__game.targets().ring, null, { timeout: 5000 }).then(() => true).catch(() => false);
    if (!ok) problem('the springform ring never lifted at the counter');
    else {
      await page.waitForTimeout(200);
      await shot('reveal-arrive');
      await slowmo(1);
      const tt = await page.evaluate(() => window.__game.targets());
      const s1 = await state();
      log.push(`reveal-arrive: station ${s1.station}, pan at ${tt.pan && Math.round(tt.pan.x)},${tt.pan && Math.round(tt.pan.y)}, ring at ${tt.ring && Math.round(tt.ring.y)}`);
      if (s1.station !== 'counter') problem(`the pan arrived but the view is at the ${s1.station}`);
      if (!tt.pan) problem('no pan at reveal-arrive');
      else if (tt.ring && !(tt.ring.y < tt.pan.y - 10)) problem('the springform ring is not lifting off the cake at reveal-arrive');
    }
  }
  await slowmo(1);
  await page.waitForFunction(() => !!window.__game.targets().cake, null, { timeout: 5000 }).catch(() => problem('no cake after the ring lifted'));
  await page.waitForTimeout(900);
  await shot('reveal');
  {
    // the secret smashing never goes off in an ordinary bake (careful carries are never hits)
    const sm = await page.evaluate(() => window.__game.smash());
    if (sm.hits) problem(`an ordinary bake smashed the scenery: ${sm.hits} hits, ${sm.breaks} breaks`);
  }
  {
    const w = await page.evaluate(() => { window.__watch.done = true; return window.__watch; });
    log.push(`watch: door max ${w.doorMax.toFixed(3)} rad, door at the step change ${w.doorAtChange}, pan/cake gap ${w.gapFrames} frames (${Math.round(w.maxGapMs)} ms), min pan-door gap ${(w.minDoorGap * 1000).toFixed(2)} mm over ${w.slidingFrames} frames`);
    if (w.doorMax > 1.7) problem(`the oven door opened to ${w.doorMax.toFixed(3)} rad (more than 1.7)`);
    if (w.doorAtChange !== 0) problem(`the oven door was at ${w.doorAtChange} rad when the Step changed (it must be shut)`);
    if (w.gapFrames > 0) problem(`${w.gapFrames} frames (${Math.round(w.maxGapMs)} ms) with neither the pan nor the cake between the bake and the reveal`);
    if (w.slidingFrames === 0) problem('never saw the pan on the open door');
    else if (w.minDoorGap < -0.001) problem(`the pan sank ${(-w.minDoorGap * 1000).toFixed(1)} mm into the open door`);
  }
  {
    // The flow between Steps: the header changes only once the view has arrived, and every
    // new header and hint animates in; the bowl is still coming down 0.2 s after step 5 and
    // home when step 6 starts.
    const w = await page.evaluate(() => window.__t10);
    for (const r of w.titles) {
      if (r.phase !== 'baking') continue;
      if (r.transition && r.transition !== 'arrive') problem(`#step-title changed to "${r.text}" during the ${r.transition} beat`);
      if (!r.settled) problem(`#step-title changed to "${r.text}" while the view was still moving`);
      if (!r.anim) problem(`#step-title "${r.text}" did not pop in`);
    }
    for (const r of w.hints) if (!r.anim) problem(`#hint "${r.text}" did not cross-fade in`);
    log.push(`header changes ${w.titles.length}, hint changes ${w.hints.length}`);
    // The cat points at what each Step wants as it starts, and hops at every done().
    const actAt = (from, to, action) => w.acts.some((a, i) => a.action === action && a.time <= to && (w.acts[i + 1]?.time ?? Infinity) >= from);
    for (const st of w.starts) {
      if (!actAt(st.time, st.time + 0.3, 'point')) problem(`the cat did not point within 300 ms of step ${st.step + 1} starting`);
    }
    // (the bake ends on its own beat: its done() goes straight to tidying up, with no react beat)
    const dones = w.trans.filter((e, i) => e.to === 'react' || (e.to === 'leave' && w.trans[i - 1]?.to !== 'react'));
    log.push(`step starts at ${w.starts.map((e) => `${e.step + 1}@${e.time.toFixed(2)}`).join(' ')}; done()s at ${dones.map((e) => `${e.step + 1}@${e.time.toFixed(2)}`).join(' ')}`);
    for (const d of dones) {
      if (!actAt(d.time, d.time + 0.4, 'hop')) problem(`the cat did not hop within 400 ms of step ${d.step + 1}'s done`);
    }
    if (w.starts.length < 6) problem(`only saw ${w.starts.length} Step starts`);
    if (dones.length < 6) problem(`only saw ${dones.length} done()s`);
    log.push(`cat acts: ${w.acts.filter((a) => a.action !== 'idle').map((a) => `${a.action}@${a.time.toFixed(2)}`).join(' ')}`);
    const beats = [];
    for (let i = 0; i < w.trans.length; i++) {
      const e = w.trans[i];
      if (e.to !== 'react') continue;
      const end = w.trans.slice(i + 1).find((x) => x.to === null);
      if (end) beats.push(`${e.step + 1}->${e.step + 2} ${(end.time - e.time).toFixed(2)} s`);
    }
    log.push(`transitions: ${beats.join(', ')}`);
    log.push(`bowl 0.2 s after step 5's done: ${w.bowlAfter === null ? '-' : (w.bowlAfter * 1000).toFixed(1)} mm over home; at step 6 start ${w.bowlAt6 === null ? '-' : (w.bowlAt6 * 1000).toFixed(2)} mm`);
    if (w.bowlAfter === null || !(w.bowlAfter > 0.01)) problem(`the bowl is not in the air 0.2 s after step 5's done (${w.bowlAfter})`);
    if (w.bowlAt6 === null || Math.abs(w.bowlAt6) > 1e-4) problem(`the bowl is not at home when step 6 starts (${w.bowlAt6})`);
  }
  let s = await state();
  log.push(`results ${JSON.stringify(s.results)} cakes ${s.cakes}`);
  {
    const nb = await page.locator('#buttons button').count();
    if (nb) problem(`${nb} button(s) under the revealed cake (they wait for the verdict)`);
    if (s.cakes !== cakes0) problem(`the cake was saved before the taste test (${s.cakes} cakes, ${cakes0} before)`);
    const hint = await page.locator('#hint').innerText();
    if (hint !== 'Drag the cake to the cat') problem(`reveal hint is "${hint}"`);
  }
  if (s.results[5] !== expect) problem(`bake result ${s.results[5]}, expected ${expect}`);
  {
    const p = await page.evaluate(() => window.__game.probe());
    log.push(`reveal top ${p.cakeTopHex}, pan top at the end of the bake ${endHex}`);
    if (p.cakeTopHex !== endHex) problem(`the revealed cake's top ${p.cakeTopHex} is not the colour it baked to (${endHex})`);
  }

  // Left alone for 6 s, the cat reaches for the cake and asks for it.
  {
    const ok = await page.waitForFunction(() => document.getElementById('bubble').textContent === 'Let me try it!', null, { timeout: 9000 }).then(() => true).catch(() => false);
    const s1 = await state();
    await shot('reveal-urge');
    if (!ok) problem('the cat never asked for the untouched cake');
    else if (s1.cat.action !== 'point') problem(`the cat asks for the cake but is not pawing at it (${s1.cat.action})`);
  }
  // Feed the cat.
  await settle();
  t = await targets('reveal');
  await drag(t.cake, t.cat, 22);
  {
    // 300 ms into the chomp (watched at a third of the speed): the head leans in, the first
    // bite is gone, and the mouth is open on the rest.
    await slowmo(3);
    const ok = await page.waitForFunction(() => { const c = window.__game.state().cat; return c.chompT !== null && c.chompT >= 0.3; }, null, { timeout: 5000 }).then(() => true).catch(() => false);
    const s = await state();
    await shot('chomp');
    if (await page.locator('#buttons button').count()) problem('buttons showed during the chomp');
    await slowmo(1);
    log.push(`chomp at ${s.cat.chompT && s.cat.chompT.toFixed(2)} s: cat ${s.cat.action}, head out ${(s.cat.headLean * 1000).toFixed(1)} mm, cake scale ${s.cakeScale && s.cakeScale.toFixed(2)}`);
    if (!ok) problem('the cat never started chomping after the cake was dropped on it');
    else {
      if (s.cat.action !== 'chomp') problem(`the cat is not chomping 300 ms in (${s.cat.action})`);
      if (!(s.cat.headLean >= 0.01)) problem(`the cat's head does not lean toward the cake (${(s.cat.headLean * 1000).toFixed(1)} mm)`);
      if (!(s.cakeScale >= 0.3 && s.cakeScale <= 0.9)) problem(`the cake is not part eaten 300 ms into the chomp (scale ${s.cakeScale})`);
    }
  }
  await page.waitForTimeout(1400);
  await shot('verdict');
  s = await state();
  if (!(await page.locator('#verdict').isVisible())) problem('verdict pill did not appear after feeding');
  else log.push('verdict: ' + (await page.locator('#verdict').innerText()) + ' / cat: ' + (await page.locator('#bubble').innerText()));
  if (s.verdict !== expect) problem(`saved verdict ${s.verdict}, expected ${expect}`);
  {
    const labels = await page.locator('#buttons button').allInnerTexts();
    if (!(labels.includes('Bake another') && labels.includes('Shelf'))) problem(`after the verdict the buttons are [${labels.join(', ')}]`);
    if (s.cakes !== cakes0 + 1) problem(`after the verdict ${s.cakes} cakes, expected ${cakes0 + 1}`);
  }

  // Shelf.
  await mark('shelf');
  await page.getByRole('button', { name: 'Shelf' }).click();
  await settle();
  await shot('shelf');
  {
    const head = await page.locator('#step-title').innerText();
    // At the Shelf the header names the Shelf; the verdict pill and the Shelf button stay at the Counter.
    if (head !== 'Your Shelf') problem(`at the Shelf the header says "${head}", not "Your Shelf"`);
    if (await page.locator('#verdict').isVisible()) problem('at the Shelf the verdict pill is still showing');
    if (await page.getByRole('button', { name: 'Shelf', exact: true }).count()) problem('at the Shelf there is still a "Shelf" button');
    if (!(await page.getByRole('button', { name: 'Bake another' }).count())) problem('at the Shelf there is no "Bake another" button');
  }
  t = await targets('shelf');
  if (!t.shelf0) problem('no cake on the shelf');
  else {
    await sinceLast();
    await page.mouse.click(t.shelf0.x, t.shelf0.y);
    await page.waitForTimeout(300);
    if (!(await page.locator('#lightbox').isVisible())) problem('tapping a shelf cake did not open the lightbox');
    else log.push('lightbox: ' + (await page.locator('#lightbox-title').innerText()) + ' / ' + (await page.locator('#lightbox-verdict').innerText()));
    if (!(await page.locator('#lightbox-img').isVisible())) problem('the lightbox shows no picture of the cake');
    await shot('lightbox');
    await page.click('#lightbox-close');
    await page.waitForTimeout(200);
    expectSounds('the lightbox', await sinceLast(), { names: ['chip', 'book'], order: true, max: 1 });
  }

  await page.getByRole('button', { name: 'Bake another' }).click();
  await settle();
  await shot('idle-again');
  s = await state();
  if (s.phase !== 'idle') problem(`expected idle after Bake another, got ${s.phase}`);
  {
    const bubble = await page.locator('#bubble').innerText();
    if (bubble !== 'Another one?') problem(`after Bake another the cat says "${bubble}"`);
    if (s.cat.action !== 'point') problem(`after Bake another the cat is not pawing at the book (${s.cat.action})`);
  }

  // Muted, nothing sounds: mute at idle, tap the book, and nothing is logged.
  {
    await page.click('#mute');
    await page.waitForTimeout(100);
    await sinceLast();
    const tb = await targets('muted idle');
    if (tb.book) await page.mouse.click(tb.book.x, tb.book.y);
    await page.waitForTimeout(400);
    const ev = await sinceLast();
    log.push(`muted: tapped the book, book open ${await page.locator('#book').isVisible()}, ${ev.length} sounds logged`);
    if (!(await page.locator('#book').isVisible())) problem('tapping the book while muted did not open it');
    if (ev.length) problem(`muted, tapping the book still logged ${ev.map((e) => e.name).join(', ')}`);
    await page.click('#book-close');
    await page.click('#mute');
    await page.waitForTimeout(100);
  }
  await checkSounds();

  // No step title runs past its line.
  for (const r of (await page.evaluate(() => window.__t10.titleFit))) {
    if (r.sw > r.cw) problem(`step title "${r.text}" overflows its line (${r.sw} > ${r.cw} px)`);
  }
  log.push(`step titles: ${(await page.evaluate(() => window.__t10.titleFit)).map((r) => `${r.text} ${r.sw}/${r.cw}`).join(', ')}`);
  await page.reload({ timeout: NAV_TIMEOUT });
  await page.waitForFunction(() => window.__game && !document.getElementById('start').disabled, null, { timeout: 30000 });
  const after = await state();
  if (after.cakes !== s.cakes) problem(`after reload ${after.cakes} cakes, expected ${s.cakes}`);
  log.push(`after reload cakes: ${after.cakes} verdict ${after.verdict}`);
  await page.click('#start');
  await page.waitForTimeout(800);
  if (await page.evaluate(() => window.__game.chevrons())) problem('the swipe chevrons came back after a swipe and a reload');
  await page.screenshot({ path: path.join(SHOTS, `${tag}-${prefix}zz-reloaded.png`) });
  if (offOrigin.length) problem(`requests left the origin: ${[...new Set(offOrigin)].slice(0, 4).join(', ')}`);
}

/** In the page, before anything runs: every line #loading shows, in order. */
function recordLoading() {
  window.__loadingSeq = [];
  const hook = () => {
    const el = document.getElementById('loading');
    if (!el) return;
    const push = () => { const t = el.textContent; if (window.__loadingSeq[window.__loadingSeq.length - 1] !== t) window.__loadingSeq.push(t); };
    push();
    new MutationObserver(push).observe(el, { childList: true, characterData: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook); else hook();
}

/** The two side runs: no WebGL at all, and a Shelf with more than a dozen cakes. */
async function sideRuns() {
  const url = `http://localhost:${server.address().port}/`;
  // A browser that can't give the kitchen a WebGL context gets a friendly line, never an error.
  {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(url, { timeout: NAV_TIMEOUT });
      const ok = await page.waitForFunction(() => /can't open the kitchen/.test(document.getElementById('loading').textContent), null, { timeout: 5000 }).then(() => true).catch(() => false);
      const st = await page.evaluate(() => ({ text: document.getElementById('loading').textContent, startHidden: document.getElementById('start').hidden }));
      await page.screenshot({ path: path.join(SHOTS, `${tag}-side-no-webgl.png`) });
      log.push(`no WebGL: "${st.text}", start hidden ${st.startHidden}`);
      if (!ok) problem0('without WebGL the friendly message did not show within 5 s');
      if (!st.startHidden) problem0('without WebGL the Start button still shows');
      for (const e of errors) problem0(`without WebGL: pageerror ${e}`);
    } catch (e) {
      problem0(`no-WebGL run: SCRIPT ERROR ${e.message.split('\n')[0]}`);
    } finally { await ctx.close().catch(() => {}); }
  }
  // Fourteen cakes: the Shelf shows the latest dozen and an "and 2 more" card that lists the rest.
  {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript((seed) => { localStorage.setItem('little-cake-kitchen.gallery', JSON.stringify(seed)); }, SEED14);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problem0(`shelf run: pageerror ${e.message}`));
    try {
      await page.goto(url, { timeout: NAV_TIMEOUT });
      await page.waitForFunction(() => window.__game && !document.getElementById('start').disabled, null, { timeout: 30000 });
      await page.click('#start');
      await page.evaluate(() => window.__game.goTo('fridge'));
      await page.waitForFunction(() => window.__game.state().settled, null, { timeout: 5000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${tag}-side-shelf-more.png`) });
      const t = await page.evaluate(() => window.__game.targets());
      const shelfCakes = Object.keys(t).filter((k) => /^shelf\d+$/.test(k)).length;
      if (shelfCakes !== 12) problem0(`with 14 cakes the Shelf holds ${shelfCakes}, not 12`);
      if (!t.more) problem0('with 14 cakes there is no "more" card');
      else {
        if (t.more.x < MARGIN || t.more.x > viewport.width - MARGIN || t.more.y < MARGIN || t.more.y > viewport.height - MARGIN) problem0(`the "more" card is off screen (${Math.round(t.more.x)},${Math.round(t.more.y)})`);
        await page.mouse.click(t.more.x, t.more.y);
        await page.waitForTimeout(300);
        const open = await page.locator('#more').isVisible();
        const items = await page.locator('#more-list li .n').allInnerTexts();
        await page.screenshot({ path: path.join(SHOTS, `${tag}-side-more-list.png`) });
        log.push(`more list: open ${open}, ${items.join(' ')}`);
        if (!open) problem0('tapping the "more" card did not open the list');
        else if (items.join(' ') !== '#1 #2') problem0(`the "more" list shows [${items.join(' ')}], expected #1 #2`);
      }
    } catch (e) {
      problem0(`shelf run: SCRIPT ERROR ${e.message.split('\n')[0]}`);
    } finally { await ctx.close().catch(() => {}); }
  }
}
const problem0 = (text) => problems.push(text);

(async () => {
  await new Promise((r) => server.listen(0, r));
  browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  for (const aim of aims) {
    const prefix = aims.length > 1 ? `${aim}-` : '';
    if (prefix) log.push(`---- bake aim: ${aim} ----`);
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: Number(process.env.DSF) || 1 });
    await ctx.addInitScript((seed) => {
      if (!localStorage.getItem('little-cake-kitchen.gallery')) localStorage.setItem('little-cake-kitchen.gallery', JSON.stringify(seed));
    }, SEED);
    await ctx.addInitScript(recordLoading);
    // The font CDN is unreachable: the game must not need it.
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console.${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await play(page, aim, prefix);
    } catch (e) {
      problems.push(`${prefix ? `[${aim}] ` : ''}SCRIPT ERROR ${e.message.split('\n')[0]}`);
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  await sideRuns();
})().catch((e) => { problems.push('SCRIPT ERROR ' + e.message.split('\n')[0]); })
  .finally(async () => {
    if (browser) {
      const closed = await Promise.race([browser.close().then(() => true), sleep(10000).then(() => false)]);
      if (!closed) console.log('browser did not close within 10 s');
    }
    server.close();
    if (panShots.right && panShots.over) {
      const a = panShots.right, b = panShots.over;
      let differ = 0;
      for (let i = 0; i < a.length; i += 3) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 20) differ++;
      const frac = differ / (a.length / 3);
      log.push(`pan at s5-done, right vs over: ${(frac * 100).toFixed(1)}% of its pixels differ`);
      if (frac <= 0.02) problems.push(`the "right" and "over" pans look the same at s5-done (${(frac * 100).toFixed(1)}% of pixels differ)`);
    }
    console.log(log.join('\n'));
    for (const [key, shots] of warns) console.log(`allowed overlap: ${key}  [${shots.join(', ')}]`);
    console.log('screenshots in', SHOTS);
    console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS');
    // Exit explicitly so a stuck browser or server never keeps the process (and the exit code) hanging.
    process.exit(problems.length ? 1 : 0);
  });

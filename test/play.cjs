// Plays a whole Basque cheesecake headlessly against dist/: book -> 6 steps -> reveal ->
// feed the cat -> shelf -> reload. Screenshots every stage and checks what it can see:
// the meter ring is really drawn, every target the game advertises is on screen, the
// cat's bubble never covers the step title and its hat is never cut off, nothing shares a
// slot (props that overlap each other, the HUD or the viewport edge are PROBLEMS unless
// the ALLOWED list below says why that pair belongs together), the pan is gone while the
// eggs and the pourables use the front slot, and only one pourable is ever out.
//
// The camera rail gets its own checks: a Station hop settles honestly (not before 0.45 s,
// by 1 s) and never jumps; idle swipes turn one Station at a time; a swipe mid-Step only
// tugs the view and comes back. Twelve earlier cakes are seeded into local storage so the
// Shelf shows both of its rows, and the Stove shot must have the oven door at the centre.
//
//   npm run build && node test/play.cjs [phone|desktop] [classic|blueberry|lemon] [under|right|over|all]
//
// Env: SHOTS_DIR (where screenshots go), CHROME_PATH (a Chromium binary for Playwright).
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.md': 'text/plain', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const NAV_TIMEOUT = 120000;
const MARGIN = 16;        // px: every target must sit at least this far inside the viewport
const CONTACT = 0.003;    // m: boxes that overlap less than this are just resting on each other
const PAN_CLEAR = 60;     // px: the parked pan must be at least this far from anything the player aims at

/**
 * Pairs whose boxes may overlap, and in which shots. Keys are "a~b" with prop names sorted
 * (a HUD name or "viewport" always last). Everything else that overlaps is a PROBLEM.
 */
const ALLOWED = [
  { pair: /^shelf~shelf\d+$/, why: 'cakes sit on the Shelf; its riser and pink trim lift its box over their bases' },
  { pair: /^shelf~viewport$/, why: 'the Shelf plank is a touch wider than a phone; every cake on it must still be inside' },
  { pair: /^(pan|oven|ovenDoor|fridge|shelf|shelf\d+)~bubble$/, why: "the cat's line docks bottom-left while the cat is out of view (Stove, Fridge)" },
  { pair: /^(oven|ovenDoor)~(viewport|stepHead)$/, why: 'the oven fills the Stove view on purpose' },
  { pair: /^oven~pan$/, shots: /s6-(in-oven|bake)/, why: 'the pan is inside the oven' },
  { pair: /^(oven|ovenDoor)~pan$/, shots: /s6-out/, why: 'the pan is on its way out through the open door in this shot' },
  { pair: /^pan~stepHead$/, shots: /s6-(in-oven|bake)/, why: 'the pan inside the oven sits under the header on wide screens, as the oven does' },
  { pair: /^(bowl|whisk|jug|cup|dish|lemon|cat)~bubble$/, why: 'the bubble floats beside the cat for 3.5 s, over the bowl and whatever is in or over it' },
  { pair: /^sheet~bubble$/, shots: /s1-(start|swipe)/, why: "the cat's opening line floats over the back-right slot for 3.5 s; the sheet is still draggable through it" },
  { pair: /^(bowl|cat|pan|ring|sheet)~viewport$/, shots: /s1-swipe$/, why: 'the view is tugged 6 cm sideways by a locked swipe in this shot' },
  { pair: /^cake~cat$/, shots: /chomp/, why: "the cake is in the cat's mouth, going down in three bites" },
  { pair: /^cake~bubble$/, shots: /s6-out|reveal|chomp|verdict/, why: "the cake sits in the bowl's slot beside the cat; its line floats over the cake for 3.5 s" },
  { pair: /^fridge~(viewport|stepHead)$/, tags: ['desk'], why: 'the fridge is taller than the view and stands at the left edge, under the header on wide screens' },
  { pair: /^(jug|cup|dish|lemon)~viewport$/, shots: /s3-done|s4-(start|item\d-(released|after))/, why: 'vessels slide in from and out to the wings; a shot can catch one crossing the edge (s3-done can land after step 4 has begun)' },
  { pair: /^pan~viewport$/, shots: /s4to5-transition/, why: 'the pan is sliding in from the park slot in this shot' },
  // The landscape rig looks along the counter, so the step header and its ring sit over the
  // bowl's far rim and whatever is lifted over the bowl. Portrait has room; this is a camera
  // matter (camera.ts), not a slot clash.
  { pair: /^bowl~whisk$/, shots: /s2-/, why: 'the whisk stands in the bowl' },
  { pair: /^carton~egg\d$/, shots: /s3-/, why: 'the eggs sit in the carton cups' },
  { pair: /^lining~ring$/, shots: /s1-/, why: 'the lining sits inside the ring (a separate check asserts it fits)' },
  { pair: /^bowl~(jug|cup|dish|lemon)$/, shots: /s4-item\d-(holding|released|after)/, why: "a tilted vessel's lip dips below the rim plane while it pours" },
  { pair: /^bowl~(pan|viewport|stepHead)$/, shots: /s5-holding/, why: 'the lifted, tipped bowl hangs over the pan and fills the frame' },
];
/** Twelve earlier cakes, so the Shelf shows both rows (seeded into local storage only when it is empty). */
const SEED = Array.from({ length: 12 }, (_, i) => {
  const q = ['under', 'right', 'over'][i % 3];
  return { n: i + 1, recipe: i % 4 === 3 ? 'tiramisu' : 'basque', flavor: ['classic', 'blueberry', 'lemon'][i % 3], quality: q, verdict: i % 5 === 4 ? undefined : q, date: new Date(2026, 0, 1 + i).toISOString() };
});
const allowed = (key, shotName) => ALLOWED.some((a) => a.pair.test(key) && (!a.shots || a.shots.test(shotName)) && (!a.tags || a.tags.includes(tag)));
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
const aims = aimArg === 'all' ? ['under', 'right', 'over'] : [aimArg];
const problems = [];
const log = [];
const warns = new Map(); // "a~b" -> shots it was seen in
let browser;

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
      if (allowed(key, name)) { if (!warns.has(key)) warns.set(key, []); warns.get(key).push(prefix + name); return; }
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
    const view = { x: 0, y: 0, w: b.viewport.w, h: b.viewport.h };
    for (const [name, p] of Object.entries(b.props)) {
      const s = p.screen;
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const near = cx >= 0 && cx <= view.w && cy >= 0 && cy <= view.h; // props at other Stations are off screen on purpose
      if (near && (s.x < 0 || s.y < 0 || s.x + s.w > view.w || s.y + s.h > view.h)) overlap(`${name}~viewport`);
      for (const [hudName, r] of Object.entries(b.hud)) if (rectsCross(s, r)) overlap(`${name}~${hudName}`);
    }
    if (rectsCross(b.hud.bubble, b.hud.stepHead)) problem(`bubble overlaps the step header (${name})`);
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
  // The cat's fur against the wooden counter: fur is a touch lighter and pinker (measured on the phone render).
  const furLike = ([r, g, b]) => r >= 240 && g >= 205 && g <= 240 && b >= 165 && b <= 225 && r - b >= 30;

  const ringCheck = async (where) => {
    const box = await page.locator('#ring').boundingBox();
    if (!box || box.height <= 0) problem(`ring not visible (${where})`);
  };
  const settle = async () => { await page.waitForFunction(() => window.__game.state().settled, null, { timeout: 8000 }); await page.waitForTimeout(150); };
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

  await page.goto(`http://localhost:${server.address().port}/?fps`, { timeout: NAV_TIMEOUT });
  await page.waitForFunction(() => window.__game && !document.getElementById('start').disabled, null, { timeout: 30000 });
  await page.click('#start');
  await page.waitForTimeout(900);
  await shot('idle');

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
  }
  // Swiping while idle turns between Stations: one swipe, one Station.
  for (const [dx, expect] of [[300, 'counter'], [300, 'fridge'], [-300, 'counter'], [-300, 'stove'], [300, 'counter']]) {
    await swipe(dx);
    await settle();
    const s = await state();
    if (s.station !== expect) problem(`idle swipe of ${dx} px reached ${s.station}, expected ${expect}`);
    if (expect === 'fridge') await shot('idle-fridge');
  }
  log.push('idle swipes: stove -> counter -> fridge -> counter -> stove -> counter');

  let t = await targets('idle');
  await page.mouse.click(t.book.x, t.book.y);
  await page.waitForTimeout(300);
  if (!(await page.locator('#book').isVisible())) problem('tapping the book did not open it');
  await shot('book');
  await page.locator('#book-flavors .chip', { hasText: flavor.charAt(0).toUpperCase() + flavor.slice(1) }).click();
  await page.click('#book-bake');
  await page.waitForTimeout(500);

  // Step 1: line the pan.
  await settle();
  log.push('step 1: ' + (await stepTitle()));
  t = await targets('step 1');
  await shot('s1-start');
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
  await drag(t.sheet, t.pan);
  {
    const b = await shot('s1-done');
    // The crinkled lining must fit inside the ring (x and z; it rises above it on purpose).
    const lining = b.props.lining, ring = b.props.ring;
    if (!lining || !ring) problem('lining or ring missing at s1-done');
    else {
      for (const i of [0, 2]) if (lining.world.min[i] < ring.world.min[i] || lining.world.max[i] > ring.world.max[i]) problem(`lining pokes through the ring (axis ${i === 0 ? 'x' : 'z'})`);
    }
  }
  await waitStep(1, 'step 1 (line the pan)');

  // Step 2: stir.
  await settle();
  log.push('step 2: ' + (await stepTitle()));
  t = await targets('step 2');
  await shot('s2-start');
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
    await page.mouse.down();
    for (let i = 0; i < 400; i++) {
      a += 0.38;
      await page.mouse.move(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * 0.7);
      await page.waitForTimeout(14);
      if (i % 6 === 0 && (await progress()) >= 0.7) break;
    }
    await shot('s2-stirring');
    await ringCheck('s2-stirring');
    log.push(`s2: stirred to p=${(await progress()).toFixed(2)}`);
    await page.mouse.up();
  }
  await waitStep(2, 'step 2 (stir)');

  // Step 3: eggs. The pan is parked off screen: the carton has the front slot to itself.
  await settle();
  log.push('step 3: ' + (await stepTitle()));
  await shot('s3-start');
  for (let i = 0; i < 3; i++) {
    t = await targets(`step 3 egg ${i}`, ['pan']);
    panClear(t, `step 3 egg ${i}`);
    const egg = t[`egg${i}`];
    await page.mouse.move(egg.x, egg.y);
    await page.mouse.down();
    await page.mouse.move(t.outside.x + i * 10, t.outside.y, { steps: 20 });
    await page.waitForTimeout(200);
    await page.mouse.move(t.inside.x + i * 10, t.inside.y, { steps: 2 });
    await page.waitForTimeout(120);
    if (i === 0) await shot('s3-crack');
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
  await shot('s3-done');
  await waitStep(3, 'step 3 (eggs)');

  // Steps 4 and 5 run at quarter speed so the holding shots land mid-pour.
  await slowmo(4);

  // Step 4: pour cream, flour, add-in. One pourable at a time, still no pan.
  await settle();
  log.push('step 4: ' + (await stepTitle()));
  await shot('s4-start');
  for (let i = 0; i < 4; i++) {
    const s = await state();
    if (s.step !== 3 || !s.stage || s.stage === 'done') break; // the last vessel is leaving (or gone); the Step index moves on after that
    t = await targets(`step 4 item ${i}`, ['pan']);
    if (!t.anywhere) break;
    panClear(t, `step 4 item ${i}`);
    await hold(t.anywhere, 0.68, `s4-item${i}`);
    await page.waitForTimeout(700);
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
  t = await targets('step 5');
  {
    const b = await shot('s5-start');
    if (!b.props.pan) problem('no pan at s5-start');
    for (const name of ['jug', 'cup', 'dish', 'lemon']) if (b.props[name]) problem(`${name} still out at s5-start`);
    if (Math.abs(t.pan.x - viewport.width / 2) > 40) problem(`pan not centred at s5-start (x=${Math.round(t.pan.x)})`);
    if (!midPan || !(midPan.x > t.pan.x + 40)) problem(`pan did not slide in from the right (mid x=${midPan && Math.round(midPan.x)}, final x=${Math.round(t.pan.x)})`);
    log.push(`pan slid in: x ${midPan && Math.round(midPan.x)} -> ${Math.round(t.pan.x)}`);
  }
  await hold(t.anywhere, 0.7, 's5');
  await waitStep(5, 'step 5 (pour into pan)');
  await slowmo(1);

  // Step 6: bake at the stove. The pan slides in from the Stove's park slot.
  await settle();
  await page.waitForFunction(() => window.__game.state().panArrived, null, { timeout: 4000 }).catch(() => problem('the pan never arrived at the stove'));
  log.push('step 6: ' + (await stepTitle()) + ' / station ' + (await state()).station);
  {
    // The Stove pose puts the oven door at the centre of the screen, with the pan in front of it.
    const b = await shot('s6-stove');
    const d = b.props.ovenDoor && b.props.ovenDoor.screen;
    if (!d) problem('no oven door at s6-stove');
    else {
      const off = Math.hypot(d.x + d.w / 2 - viewport.width / 2, d.y + d.h / 2 - viewport.height / 2);
      if (off > 40) problem(`oven door centre is ${Math.round(off)} px off the screen centre at s6-stove`);
      log.push(`oven door centre ${Math.round(off)} px from the screen centre`);
    }
  }
  t = await targets('step 6');
  await drag(t.pan, t.ovenMouth, 25);
  await page.waitForTimeout(1600);
  await shot('s6-in-oven');
  t = await targets('step 6 in oven');
  const until = aim === 'under' ? 0.4 : aim === 'over' ? 0.95 : 0.72;
  await hold(t.anywhere, until, 's6-bake');
  await page.waitForTimeout(900);
  await shot('s6-out');
  await page.waitForFunction(() => window.__game.state().phase === 'reveal', null, { timeout: 8000 }).catch(() => problem('bake did not reach the reveal'));
  await page.waitForTimeout(1200);
  await shot('reveal');
  let s = await state();
  log.push(`results ${JSON.stringify(s.results)} cakes ${s.cakes}`);
  if (s.results[5] !== aim) problem(`bake result ${s.results[5]}, expected ${aim}`);

  // Feed the cat.
  await settle();
  t = await targets('reveal');
  await drag(t.cake, t.cat, 22);
  await page.waitForTimeout(600);
  await shot('chomp');
  await page.waitForTimeout(1400);
  await shot('verdict');
  s = await state();
  if (!(await page.locator('#verdict').isVisible())) problem('verdict pill did not appear after feeding');
  else log.push('verdict: ' + (await page.locator('#verdict').innerText()) + ' / cat: ' + (await page.locator('#bubble').innerText()));
  if (s.verdict !== aim) problem(`saved verdict ${s.verdict}, expected ${aim}`);

  // Shelf.
  await page.getByRole('button', { name: 'Shelf' }).click();
  await settle();
  await shot('shelf');
  t = await targets('shelf');
  if (!t.shelf0) problem('no cake on the shelf');
  else {
    await page.mouse.click(t.shelf0.x, t.shelf0.y);
    await page.waitForTimeout(300);
    if (!(await page.locator('#lightbox').isVisible())) problem('tapping a shelf cake did not open the lightbox');
    else log.push('lightbox: ' + (await page.locator('#lightbox-title').innerText()) + ' / ' + (await page.locator('#lightbox-verdict').innerText()));
    await shot('lightbox');
    await page.click('#lightbox-close');
  }

  await page.getByRole('button', { name: 'Bake another' }).click();
  await settle();
  await shot('idle-again');
  s = await state();
  if (s.phase !== 'idle') problem(`expected idle after Bake another, got ${s.phase}`);

  await page.reload({ timeout: NAV_TIMEOUT });
  await page.waitForFunction(() => window.__game && !document.getElementById('start').disabled, null, { timeout: 30000 });
  const after = await state();
  if (after.cakes !== s.cakes) problem(`after reload ${after.cakes} cakes, expected ${s.cakes}`);
  log.push(`after reload cakes: ${after.cakes} verdict ${after.verdict}`);
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  for (const aim of aims) {
    const prefix = aims.length > 1 ? `${aim}-` : '';
    if (prefix) log.push(`---- bake aim: ${aim} ----`);
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await ctx.addInitScript((seed) => {
      if (!localStorage.getItem('little-cake-kitchen.gallery')) localStorage.setItem('little-cake-kitchen.gallery', JSON.stringify(seed));
    }, SEED);
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
})().catch((e) => { problems.push('SCRIPT ERROR ' + e.message.split('\n')[0]); })
  .finally(async () => {
    if (browser) {
      const closed = await Promise.race([browser.close().then(() => true), sleep(10000).then(() => false)]);
      if (!closed) console.log('browser did not close within 10 s');
    }
    server.close();
    console.log(log.join('\n'));
    for (const [key, shots] of warns) console.log(`allowed overlap: ${key}  [${shots.join(', ')}]`);
    console.log('screenshots in', SHOTS);
    console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS');
    // Exit explicitly so a stuck browser or server never keeps the process (and the exit code) hanging.
    process.exit(problems.length ? 1 : 0);
  });

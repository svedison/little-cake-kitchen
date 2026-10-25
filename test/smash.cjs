// The secret smashing, headless: start a recipe, swing the parchment hard into the crock until
// it breaks, then into the backsplash, and check the hits, the health bar, the weak point, the
// break, the cat's gasp and the rebuild 15 s later. Screenshots go to SHOTS_DIR.
//
//   npm run build && node test/smash.cjs [phone|desktop]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const DIST = path.join(__dirname, '..', 'dist');
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), `cremes-kitchen-smash-${process.pid}`);
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const EXE = process.env.CHROME_PATH || 'C:\\Users\\ediso\\AppData\\Local\\ms-playwright\\chromium-1178\\chrome-win\\chrome.exe';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const desktop = process.argv[2] === 'desktop';
const viewport = desktop ? { width: 1280, height: 800 } : { width: 412, height: 915 };
const problems = [];
const log = [];
const problem = (t) => problems.push(t);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(DIST, p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch({ executablePath: fs.existsSync(EXE) ? EXE : undefined, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  try {
    // the phone is a real touch phone: a mobile viewport (at 1x: software rendering at 3x is too slow to swing), fingers through CDP touch events
    const page = await (await browser.newContext(desktop ? { viewport } : { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })).newPage();
    const cdp = desktop ? null : await page.context().newCDPSession(page);
    let fx = 0, fy = 0;
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
    const finger = desktop ? page.mouse : {
      move: async (x, y, o) => { const n = (o && o.steps) || 1; for (let k = 1; k <= n; k++) await touch('touchMove', fx + (x - fx) * k / n, fy + (y - fy) * k / n); fx = x; fy = y; },
      down: async () => touch('touchStart', fx, fy),
      up: async () => touch('touchEnd', fx, fy),
    };
    if (!desktop) { const m = finger.move; finger.move = async (x, y, o) => { if (!finger.isDown) { fx = x; fy = y; return; } return m(x, y, o); }; const d = finger.down, u = finger.up; finger.down = async () => { finger.isDown = true; return d(); }; finger.up = async () => { finger.isDown = false; return u(); }; }
    page.on('console', (m) => { if (m.type() === 'error') problem(`console.error: ${m.text()}`); });
    page.on('pageerror', (e) => problem(`pageerror: ${e.message}`));
    await page.goto(`http://localhost:${server.address().port}/`, { timeout: 120000, waitUntil: 'commit' });
    await page.waitForFunction(() => window.__game && !document.getElementById('start').disabled, null, { timeout: 60000 });
    await (desktop ? page.click('#start') : page.tap('#start'));
    await page.waitForTimeout(1200);
    let n = 0;
    const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`) });
    const info = () => page.evaluate(() => window.__game.smash());
    const find = (i, name) => i.targets.find((t) => t.name === name);
    await shot('idle-counter');

    await page.evaluate(() => window.__game.startRecipe('classic'));
    await page.waitForFunction(() => { const s = window.__game.state(); return s.step === 0 && !s.transition; }, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await shot('s1-start');
    let i0 = await info();
    const crock = find(i0, 'crock');
    const plant = find(i0, 'plant');
    log.push(`crock on screen at ${Math.round(crock.screen.x)},${Math.round(crock.screen.y)}; plant at ${Math.round(plant.screen.x)},${Math.round(plant.screen.y)}`);
    for (const t of [crock, plant]) if (t.screen.x < 0 || t.screen.x > viewport.width || t.screen.y < 0 || t.screen.y > viewport.height) problem(`${t.name} is off screen at the Counter`);

    // a careful drag is never a hit: the parchment goes to the pan slowly
    const sheet = (await page.evaluate(() => window.__game.targets())).sheet;
    await finger.move(sheet.x, sheet.y);
    await finger.down();
    for (let k = 1; k <= 30; k++) { await finger.move(sheet.x, sheet.y - k * 2); await page.waitForTimeout(30); }
    await finger.up();
    await page.waitForTimeout(700);
    if ((await info()).hits) problem('a slow drag counted as a hit');

    // swing the parchment back and forth through the crock until it gives
    const at = (await page.evaluate(() => window.__game.targets())).sheet;
    await finger.move(at.x, at.y);
    await finger.down();
    const cx = crock.screen.x, cy = crock.screen.y;
    let shotHit = false, broke = null;
    for (let swing = 0; swing < 80 && !broke; swing++) {
      // a finger cannot leave the glass: swing from well left of it to the screen's edge
      const lo = Math.max(4, cx - (desktop ? 120 : 90)), hi = Math.min(viewport.width - 4, cx + 90);
      const from = swing % 2 ? hi : lo;
      const to = swing % 2 ? lo : hi;
      await finger.move(from, cy, { steps: 2 });
      await page.waitForTimeout(120);
      await finger.move(to, cy, { steps: 3 });
      await page.waitForTimeout(40);
      const i = await info();
      if (i.hits && !shotHit) {
        shotHit = true;
        await shot('first-hit');
        log.push(`first hit after ${swing + 1} swings: crock ${find(i, 'crock').hp}/${find(i, 'crock').max}, bar ${i.bar}, weak point ${i.weak}, speed ${i.speed.toFixed(2)} m/s`);
        if (!i.bar) problem('no health bar after a hit');
        if (!i.weak) problem('no weak point after the first hit on the crock');
        const nums = await page.evaluate(() => [...document.querySelectorAll('.smash-fx .dmg')].map((e) => e.textContent));
        if (!nums.length) problem('no damage number after a hit');
        else log.push(`damage numbers showing: ${nums.join(', ')}`);
      }
      const c = find(i, 'crock');
      if (c.broken) {
        broke = { swing, i };
        await page.waitForTimeout(60);
        await shot('crock-breaks');
      }
    }
    await finger.up();
    if (!shotHit) problem('80 hard swings through the crock never hit it');
    if (!broke) problem('the crock never broke');
    else {
      const i = await info();
      const bubble = await page.evaluate(() => { const b = document.getElementById('bubble'); return b && getComputedStyle(b).display !== 'none' ? b.textContent : ''; });
      log.push(`crock broke after ${broke.swing + 1} swings: ${broke.i.hits} hits, ${broke.i.crits} crits; ${i.chunks} chunks flying; the cat says "${bubble}"`);
      if (broke.i.chunks + i.chunks === 0) problem('nothing flew when the crock broke');
      if (!/KITCHEN|spoon|spatula/i.test(bubble)) problem(`the cat did not gasp at the crock ("${bubble}")`);
      await page.waitForTimeout(1300);
      const after = await info();
      if (after.chunks) problem(`${after.chunks} chunks still lying about 1.3 s after the break`);
      await shot('crock-gone');
    }

    // the cat: hit it past ten and it goes on strike (everything slows), pat it three times and it forgives
    const mood = () => page.evaluate(() => window.__game.catMood());
    /** Seconds the carried parchment takes to cover half of a quick 80 px move (the page watches every frame). */
    const followFrac = async () => {
      const a = (await page.evaluate(() => window.__game.targets())).sheet;
      await finger.move(a.x, a.y);
      await finger.down();
      await page.waitForTimeout(200);
      const watch = page.evaluate((x0) => new Promise((done) => {
        const t0 = performance.now();
        const f = () => {
          const x = window.__game.targets().sheet.x;
          if (x - x0 >= 40 || performance.now() - t0 > 6000) return done((performance.now() - t0) / 1000);
          requestAnimationFrame(f);
        };
        f();
      }), a.x);
      await finger.move(a.x + 80, a.y);
      const t = await watch;
      await finger.up();
      return t;
    };
    // on strike a dropped thing creeps home ten times slower, and can't be picked up on the way
    const settle = async () => {
      for (let i = 0; i < 100; i++) {
        if (!(await page.evaluate(() => window.__game.debug().carry?.settling))) return;
        await page.waitForTimeout(300);
      }
      problem('the parchment never got home');
    };
    await settle();
    const before = await followFrac();
    await page.waitForTimeout(1500);
    let m = await mood();
    const at3 = (await page.evaluate(() => window.__game.targets())).sheet;
    await finger.move(at3.x, at3.y);
    await finger.down();
    const said = [];
    for (let swing = 0; swing < 60 && m.hits <= 10; swing++) {
      const cxx = m.body.x, cyy = m.body.y;
      const lo = Math.max(4, cxx - 110), hi = Math.min(viewport.width - 4, cxx + 190);
      await finger.move(swing % 2 ? hi : lo, cyy, { steps: 2 });
      await page.waitForTimeout(120);
      await finger.move(swing % 2 ? lo : hi, cyy, { steps: 3 });
      await page.waitForTimeout(60);
      const was = m.hits;
      m = await mood();
      if (m.hits > was) said.push(`${m.hits}:${m.expr}:"${await page.locator('#bubble').innerText().catch(() => '')}"`);
      if (m.hits === 1 && was === 0) await shot('cat-hit');
      if (m.hits >= 5 && was < 5) await shot('cat-mad');
    }
    await finger.up();
    log.push(`cat hits: ${said.join(' | ')}`);
    if (!m.strike) problem(`the cat was hit ${m.hits} times and did not go on strike`);
    if (m.expr !== 'furious') problem(`the cat on strike looks ${m.expr}, not furious`);
    await page.waitForTimeout(400);
    await shot('cat-strike');
    await settle();
    const during = await followFrac();
    log.push(`the parchment takes ${before.toFixed(2)} s to cover half a quick move normally, ${during.toFixed(2)} s on strike`);
    if (!(during > before * 4 && during > 0.8)) problem(`on strike the parchment is not much slower (${before.toFixed(2)} s -> ${during.toFixed(2)} s)`);
    await settle();
    // three pats
    for (let i = 0; i < 3; i++) {
      const f = (await mood()).body;
      await finger.move(f.x, f.y);
      await finger.down();
      await page.waitForTimeout(80);
      await finger.up();
      await page.waitForTimeout(500);
      const mm = await mood();
      log.push(`pat ${i + 1}: hits ${mm.hits}, pats ${mm.pats}, strike ${mm.strike}, "${await page.locator('#bubble').innerText().catch(() => '')}"`);
    }
    m = await mood();
    await shot('cat-forgives');
    if (m.strike || m.hits) problem(`three pats did not end the strike (hits ${m.hits}, strike ${m.strike})`);
    const after = await followFrac();
    log.push(`after the pats it takes ${after.toFixed(2)} s`);
    if (after > before * 2 + 0.1) problem(`after the pats the parchment is still slow (${after.toFixed(2)} s)`);
    await page.waitForTimeout(1500);

    // the backsplash: swing up into the wall right of the bowl
    const wall = await page.evaluate(() => window.__game.screenOf(0.12, 0.12, -0.549));
    const at2 = (await page.evaluate(() => window.__game.targets())).sheet;
    const breaks0 = (await info()).breaks;
    await finger.move(at2.x, at2.y);
    await finger.down();
    for (let swing = 0; swing < 30; swing++) {
      await finger.move(wall.x + (swing % 3 - 1) * 25, wall.y + 120, { steps: 2 });
      await page.waitForTimeout(110);
      await finger.move(wall.x + (swing % 3 - 1) * 25, wall.y - 40, { steps: 2 });
      await page.waitForTimeout(40);
      if ((await info()).breaks - breaks0 >= 3) break;
    }
    await finger.up();
    const iw = await info();
    const tiles = iw.targets.filter((t) => t.kind === 'tile');
    log.push(`backsplash: ${tiles.length} tiles hit, ${tiles.filter((t) => t.broken).length} broken`);
    if (!tiles.some((t) => t.broken)) problem('no tile broke');
    await page.waitForTimeout(150);
    await shot('tiles-broken');

    // a while later it all builds itself back up
    await page.waitForTimeout(15500);
    let ib = await info();
    if (ib.targets.some((t) => t.building)) { await shot('rebuilding'); await page.waitForTimeout(800); ib = await info(); }
    const still = ib.targets.filter((t) => t.broken);
    log.push(`after 16 s: ${still.length} still broken`);
    if (still.length) problem(`${still.map((t) => t.name).join(', ')} never rebuilt`);
    await shot('rebuilt');
  } catch (e) {
    problem('SCRIPT ERROR ' + e.message.split('\n')[0]);
  } finally {
    await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 10000))]);
    server.close();
    console.log(log.join('\n'));
    console.log(`shots: ${SHOTS}`);
    console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'NO PROBLEMS');
    process.exit(problems.length ? 1 : 0);
  }
})();

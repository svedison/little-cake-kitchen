// Downloads the kitchen recordings into public/sounds: freesound.org preview mp3s of
// CC0 sounds only. Each sound's page is read for its preview link and its licence, so a
// sound that is not CC0 (655708, say) can never slip in. Long recordings are kept whole
// and sliced at play time by manifest.json ({ file, start, dur }), so nothing is re-encoded.
// The 1-3 minute ambiences are left out on purpose (budget). Writes CREDITS.md.
//
//   node test/fetch-sounds.cjs [--force]      (Node 18+, no dependencies)
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'sounds');
const BUDGET = 3 * 1024 * 1024; // bytes, the whole folder (SPEC.md: about 3 MB of audio)
const FORCE = process.argv.includes('--force');

/** id, the file it lands in, what the game uses it for, and the preview quality (lq for the long ones). */
const SOUNDS = [
  { id: 244741, file: 'crack-244741.mp3', use: 'egg crack' },
  { id: 336614, file: 'crack-336614.mp3', use: 'egg crack (sliced)' },
  { id: 495118, file: 'plop-495118.mp3', use: 'yolk plop' },
  { id: 134710, file: 'plop-134710.mp3', use: 'yolk plop, squelch' },
  { id: 209014, file: 'tink-209014.mp3', use: 'ceramic tap, clink' },
  { id: 235573, file: 'spoon-235573.mp3', use: 'spoon on bowl taps and clinks (sliced)', q: 'lq' },
  { id: 398898, file: 'paper-398898.mp3', use: 'parchment crumple' },
  { id: 394790, file: 'book-394790.mp3', use: 'recipe book page turn' },
  { id: 467898, file: 'whisk-467898.mp3', use: 'whisk loop (sliced)' },
  { id: 699231, file: 'pour-699231.mp3', use: 'cream pour loop and batter glug loop: thick oil pouring (sliced)', q: 'lq' },
  { id: 137259, file: 'flour-137259.mp3', use: 'flour pour loop (sliced)', q: 'lq' },
  { id: 845258, file: 'lemon-845258.mp3', use: 'lemon squeeze' },
  { id: 455538, file: 'door-455538.mp3', use: 'oven door' },
  { id: 787417, file: 'door-787417.mp3', use: 'oven door open / close (sliced)', q: 'lq' },
  { id: 320453, file: 'oven-320453.mp3', use: 'oven fan loop (sliced)', q: 'lq' },
  { id: 204103, file: 'timer-204103.mp3', use: 'timer tick loop and bell (sliced)', q: 'lq' },
  { id: 532216, file: 'chomp-532216.mp3', use: 'cat chomps (sliced)', q: 'lq' },
  { id: 404922, file: 'drop-404922.mp3', use: 'mug set down on a table' },
  { id: 235498, file: 'drop-235498.mp3', use: 'jar set down on a table' },
  { id: 460243, file: 'drop-460243.mp3', use: 'teapot set down (sliced)', q: 'lq' },
  { id: 353105, file: 'drop-353105.mp3', use: 'glass object set down (sliced)' },
  { id: 365519, file: 'grab-365519.mp3', use: 'tea mug picked up' },
  { id: 812359, file: 'grab-812359.mp3', use: 'hand closing on something (grab)' },
  { id: 532140, file: 'wet-532140.mp3', use: 'splash, drip, berry (wet slap)' },
  { id: 679391, file: 'wet-679391.mp3', use: 'splash (wet thwack)' },
  { id: 269482, file: 'wet-269482.mp3', use: 'egg white slop, berry (gooey squish)' },
  { id: 271666, file: 'wet-271666.mp3', use: 'egg white slop (wet squish)' },
  { id: 515621, file: 'wet-515621.mp3', use: 'slop, drip (small splat)' },
  { id: 855679, file: 'rack-855679.mp3', use: 'oven wire rack (sliced)', q: 'lq' },
  { id: 835789, file: 'rack-835789.mp3', use: 'baking tray onto the oven rack (sliced)', q: 'lq' },
  { id: 868283, file: 'latch-868283.mp3', use: 'oven door latch (sliced)' },
  { id: 383802, file: 'latch-383802.mp3', use: 'oven door latch (sliced)' },
  { id: 721025, file: 'creak-721025.mp3', use: 'oven door hinge creak (sliced)', q: 'lq' },
  { id: 234782, file: 'steam-234782.mp3', use: 'heat rolling out of the oven' },
  { id: 353124, file: 'sizzle-353124.mp3', use: 'cake top sizzling as it browns (loop, sliced)', q: 'lq' },
  { id: 509381, file: 'tink-509381.mp3', use: 'small glass tink' },
  { id: 107785, file: 'tink-107785.mp3', use: 'small tink' },
  { id: 800115, file: 'tink-800115.mp3', use: 'crystal tapping ceramic (tink)' },
];

async function page(id) {
  const res = await fetch(`https://freesound.org/s/${id}/`);
  if (!res.ok) throw new Error(`page ${id}: HTTP ${res.status}`);
  const html = await res.text();
  const licence = (html.match(/creativecommons\.org\/(publicdomain|licenses)\/[a-z-]+\/[0-9.]+\//) || [])[0];
  const title = (html.match(/<title>Freesound - ([^<]*)<\/title>/) || [])[1] || '';
  const m = title.match(/^(.*) by ([^ ]+)$/);
  const previews = html.match(/https:\/\/cdn\.freesound\.org\/previews\/[^"']+-(hq|lq)\.mp3/g) || [];
  return { licence, name: m ? m[1] : title, author: m ? m[2] : '?', previews };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const credits = [];
  let failed = 0;
  for (const s of SOUNDS) {
    try {
      const info = await page(s.id);
      if (info.licence !== 'creativecommons.org/publicdomain/zero/1.0/') throw new Error(`${s.id} is not CC0 (${info.licence || 'no licence found'})`);
      const url = info.previews.find((u) => u.endsWith(`-${s.q || 'hq'}.mp3`));
      if (!url) throw new Error(`${s.id}: no ${s.q || 'hq'} preview link on its page`);
      const dest = path.join(OUT, s.file);
      if (FORCE || !fs.existsSync(dest)) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      }
      credits.push({ ...s, ...info });
      console.log(`ok   ${s.id}  ${s.file.padEnd(20)} ${String(fs.statSync(dest).size).padStart(7)} B  ${info.name} by ${info.author}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${s.id}  ${e.message}`);
    }
  }

  const lines = [
    '# Sound credits',
    '',
    'Every recording here is a freesound.org preview of a sound its author released under',
    '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (no attribution required; listed with thanks).',
    'Downloaded by `node test/fetch-sounds.cjs`, which checks each licence on the sound\'s page.',
    '',
    '| id | file | sound | author | used for | licence |',
    '|---|---|---|---|---|---|',
    ...credits.map((c) => `| [${c.id}](https://freesound.org/s/${c.id}/) | ${c.file} | ${c.name.replace(/\|/g, '/')} | [${c.author}](https://freesound.org/people/${c.author}/) | ${c.use} | [CC0](https://${c.licence}) |`),
    '',
  ];
  fs.writeFileSync(path.join(OUT, 'CREDITS.md'), lines.join('\n'));

  const total = fs.readdirSync(OUT).reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`public/sounds: ${total} bytes (${(total / 1024 / 1024).toFixed(2)} MB of a ${BUDGET / 1024 / 1024} MB budget)`);
  if (failed) { console.log(`${failed} sound(s) failed`); process.exit(1); }
  if (total >= BUDGET) { console.log('over budget'); process.exit(1); }
})();

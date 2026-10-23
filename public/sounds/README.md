# Recorded sounds

CC0 kitchen recordings (freesound.org previews), fetched by `node test/fetch-sounds.cjs` and credited in [CREDITS.md](./CREDITS.md). The game decodes every file listed in `manifest.json` at page load; a sound with no recording falls back to its synthesized voice in `src/sound.ts`.

`manifest.json` (v2):

```json
{
  "crack": [
    { "file": "crack-244741.mp3", "gain": 0.9 },
    { "file": "crack-336614.mp3", "start": 3.57, "dur": 0.35, "gain": 0.9 }
  ],
  "loops": {
    "whisk": { "file": "whisk-467898.mp3", "start": 4.2, "end": 6.7, "gain": 0.6 }
  }
}
```

- A one-shot name lists its takes; one is picked at random each time (never the same twice in a row). `start`/`dur` (seconds) slice a longer recording at play time, so files are never trimmed by hand. `rate` shifts a take's pitch.
- Each take and loop is normalized to the same peak when decoded, so `gain` is a mix level (crack 0.9, plop 0.7, paper 0.6, tick 0.4, loops 0.5-0.7) rather than a fix for a quiet file.
- A loop is the slice `[start, end)` played round and round; its seam is crossfaded over 60 ms.

Keep the whole folder under 3 MB (the fetch script prints the total).

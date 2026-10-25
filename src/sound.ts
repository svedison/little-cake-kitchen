// Kitchen sounds. Recorded CC0 takes (public/sounds, listed in manifest.json and fetched by
// test/fetch-sounds.cjs) are decoded at load; any sound without a recording is synthesized
// from a click, a few resonant body modes and a noise tail, so every event still has a voice.
// Sustained sounds (whisk, pour, oven, ...) are Loops whose level follows the physics.
//
// manifest.json (v2):
//   { "<name>": [{ file, start?, dur?, gain?, rate? }, ...],          one-shot takes
//     "loops": { "<LoopName>": { file, start, end, gain? } } }        a recorded slice, looped
// Long recordings are sliced at play time (start/dur), so files are never trimmed by hand.

export type SoundName =
  | 'crack' | 'plop' | 'tap' | 'clink' | 'paper' | 'door' | 'chomp' | 'confetti' | 'pop' | 'berry' | 'lemon'
  | 'grab' | 'drop' | 'slide' | 'swoosh' | 'book' | 'chip' | 'latch' | 'creak' | 'rack' | 'tick' | 'chime'
  | 'over' | 'meh' | 'pat' | 'bell' | 'gulp' | 'cheer' | 'squelch' | 'splash' | 'drip' | 'steam' | 'clunk' | 'slop' | 'tink'
  | 'whack' | 'smash' | 'crit' | 'build' | 'mew' | 'growl' | 'hiss' | 'purr';
export type LoopName = 'whisk' | 'pour' | 'oven' | 'flour' | 'tick' | 'glug' | 'sizzle';

/** Physics a Loop can follow besides its level. */
export interface LoopExtra {
  /** Whisk stroke phase, 0..1 round the bowl. */
  phase?: number;
  /** How full the vessel being poured into is, 0..1 (a filling vessel rings higher). */
  fill?: number;
  /** Oven heat, 0..1. */
  heat?: number;
  /** The Step's stage, for loops that change character with it (the sizzle crackles faster as the top browns). */
  stage?: string;
  /** Playback rate (the timer ticks faster as the bake goes on). */
  rate?: number;
}

export interface Loop {
  /** Call every frame with 0..1 (and any physics it follows); stop() when done. */
  set(level: number, extra?: LoopExtra): void;
  stop(): void;
}

export interface SoundEvent { t: number; name: string; kind: 'synth' | 'sample'; gain: number; rate: number }

interface TakeEntry { file: string; start?: number; dur?: number; gain?: number; rate?: number }
interface LoopEntry { file: string; start: number; end: number; gain?: number }
type Manifest = Partial<Record<SoundName, TakeEntry[]>> & { loops?: Partial<Record<LoopName, LoopEntry>> };

interface Take { buffer: AudioBuffer; start: number; dur: number; gain: number; rate: number }
interface LoopSample { buffer: AudioBuffer; gain: number; norm: number }

const MUTE_KEY = 'little-cake-kitchen.muted';
const MASTER = 0.9;
const LOG_SIZE = 200;
const XFADE = 0.06; // s: a recorded loop's seam is crossfaded over this long
const REPEAT_WINDOW = 0.3; // s: hits closer than this rotate their pitch so no two match
const REPEAT_RATES = [1.12, 0.89, 1];
const GLUG_RATE = 0.92; // the batter loop: the thick oil pour a touch slower and duller than the cream's
/** Crackles per second in the sizzle, by bake stage (by ear: none while pale, a frying patter once burnt). */
const CRACKLE: Record<string, number> = { pale: 0, golden: 2, burnt: 6, charred: 10 };

// ---- synthesized voices ------------------------------------------------------------------
// A contact sound is a transient (2-8 ms click), a body (resonant bandpass modes: Q 8-30
// rings like ceramic, metal or glass; Q 1-2 is wet or soft) and a noise tail with its own
// envelope. Tones are for the few musical cues (chime, bell, confetti). All tuned by ear.

interface Mode { f: number; q: number; g: number; d: number }
interface Tail { type: BiquadFilterType; f: number; to?: number; q: number; g: number; a?: number; d: number; at?: number }
interface Tone { f: number; to?: number; g: number; d: number; at?: number; type?: OscillatorType }
interface Voice {
  click?: { g: number; d?: number };
  modes?: Mode[];
  tail?: Tail;
  tones?: Tone[];
  /** Several hits in a burst (shell snaps, paper crinkles): n hits, gap s apart, each fall quieter. */
  repeat?: { n: number; gap: number; jitter: number; fall: number };
}

const VOICES: Record<SoundName, Voice> = {
  // Eggshell: three brittle snaps and a soft knock.
  crack: { click: { g: 0.7, d: 0.004 }, modes: [{ f: 2900, q: 8, g: 0.45, d: 0.05 }, { f: 4300, q: 10, g: 0.3, d: 0.04 }], tail: { type: 'lowpass', f: 320, q: 1, g: 0.25, d: 0.08 }, repeat: { n: 3, gap: 0.022, jitter: 0.015, fall: 0.25 } },
  // Yolk landing in batter.
  plop: { tones: [{ f: 520, to: 110, g: 0.45, d: 0.12 }], modes: [{ f: 700, q: 1.5, g: 0.3, d: 0.08 }], tail: { type: 'lowpass', f: 900, q: 1, g: 0.12, d: 0.06, at: 0.01 } },
  // Something light knocking a ceramic rim.
  tap: { click: { g: 0.45, d: 0.003 }, modes: [{ f: 1850, q: 20, g: 0.25, d: 0.06 }, { f: 3700, q: 24, g: 0.12, d: 0.04 }] },
  // Shell or spoon on ceramic: a brighter, longer ring.
  clink: { click: { g: 0.5, d: 0.003 }, modes: [{ f: 3300, q: 25, g: 0.3, d: 0.18 }, { f: 5200, q: 30, g: 0.18, d: 0.12 }, { f: 7900, q: 30, g: 0.08, d: 0.08 }] },
  paper: { click: { g: 0.1, d: 0.003 }, tail: { type: 'highpass', f: 3200, q: 1, g: 0.25, d: 0.05 }, repeat: { n: 6, gap: 0.04, jitter: 0.02, fall: 0.1 } },
  door: { click: { g: 0.4, d: 0.005 }, modes: [{ f: 140, q: 8, g: 0.5, d: 0.12 }, { f: 420, q: 10, g: 0.2, d: 0.1 }], tail: { type: 'lowpass', f: 500, q: 1, g: 0.25, d: 0.1 } },
  chomp: { click: { g: 0.3, d: 0.004 }, tail: { type: 'lowpass', f: 600, q: 1.5, g: 0.5, d: 0.07 }, tones: [{ f: 220, to: 90, g: 0.25, d: 0.07 }] },
  confetti: { tones: [523, 659, 784, 1047].map((f, i) => ({ f, g: 0.18, d: 0.3, at: i * 0.09, type: 'triangle' as OscillatorType })), tail: { type: 'highpass', f: 4000, q: 0.5, g: 0.1, d: 0.3 } },
  pop: { click: { g: 0.2, d: 0.002 }, tones: [{ f: 600, to: 300, g: 0.3, d: 0.06 }] },
  // A blueberry landing in batter: a small, damped, unpitched thud (no sweep, so never a 'pew').
  berry: { click: { g: 0.08, d: 0.004 }, modes: [{ f: 260, q: 1.2, g: 0.18, d: 0.05 }], tail: { type: 'lowpass', f: 700, q: 0.7, g: 0.14, a: 0.003, d: 0.06 } },
  lemon: { tail: { type: 'bandpass', f: 1200, to: 800, q: 1, g: 0.3, a: 0.02, d: 0.2 }, modes: [{ f: 400, q: 2, g: 0.15, d: 0.1 }] },
  grab: { click: { g: 0.15, d: 0.003 }, tail: { type: 'lowpass', f: 1200, q: 1, g: 0.15, d: 0.05 } },
  // Something set down on the wooden counter.
  drop: { click: { g: 0.4, d: 0.005 }, modes: [{ f: 220, q: 2, g: 0.4, d: 0.08 }], tail: { type: 'lowpass', f: 400, q: 1, g: 0.2, d: 0.1 } },
  slide: { tail: { type: 'bandpass', f: 1500, q: 1, g: 0.15, a: 0.05, d: 0.25 } },
  // The view turning: air past the ear, a bandpass swept 400 -> 1200 Hz over 250 ms.
  swoosh: { tail: { type: 'bandpass', f: 400, to: 1200, q: 1.2, g: 0.5, a: 0.09, d: 0.16 } },
  book: { tail: { type: 'highpass', f: 2500, q: 0.8, g: 0.2, a: 0.03, d: 0.15 }, repeat: { n: 2, gap: 0.08, jitter: 0.03, fall: 0.3 } },
  chip: { click: { g: 0.3, d: 0.002 }, modes: [{ f: 4200, q: 18, g: 0.15, d: 0.03 }] },
  latch: { click: { g: 0.6, d: 0.003 }, modes: [{ f: 1900, q: 14, g: 0.3, d: 0.07 }, { f: 3100, q: 18, g: 0.2, d: 0.05 }], repeat: { n: 2, gap: 0.05, jitter: 0.01, fall: 0.4 } },
  creak: { tones: [{ f: 180, to: 140, g: 0.05, d: 0.35, type: 'sawtooth' }], tail: { type: 'bandpass', f: 600, to: 900, q: 8, g: 0.25, a: 0.1, d: 0.3 } },
  // The oven's wire rack.
  rack: { click: { g: 0.5, d: 0.003 }, modes: [{ f: 820, q: 12, g: 0.3, d: 0.15 }, { f: 1630, q: 16, g: 0.2, d: 0.1 }, { f: 2950, q: 20, g: 0.12, d: 0.08 }] },
  tick: { click: { g: 0.35, d: 0.002 }, modes: [{ f: 3000, q: 10, g: 0.15, d: 0.015 }] },
  // A sweet spot reached: two rising glassy notes (a fifth apart), unlike the timer's bell.
  chime: { tones: [{ f: 1319, g: 0.14, d: 0.45 }, { f: 2638, g: 0.035, d: 0.25 }, { f: 1976, g: 0.14, d: 0.6, at: 0.11 }, { f: 3952, g: 0.03, d: 0.3, at: 0.11 }] },
  // Past the sweet spot: a descending double tock, like a wood block. Soft, never a buzzer.
  over: { click: { g: 0.25, d: 0.003 }, tones: [{ f: 988, g: 0.2, d: 0.09, type: 'triangle' }, { f: 740, g: 0.2, d: 0.12, at: 0.16, type: 'triangle' }], modes: [{ f: 988, q: 10, g: 0.12, d: 0.06 }] },
  // A 'mid' verdict: one soft, level wood-block knock twice at the same pitch. Neither the
  // rising chime (success) nor the falling tock (too far); it just shrugs.
  meh: { click: { g: 0.15, d: 0.003 }, tones: [{ f: 784, g: 0.16, d: 0.1, type: 'triangle' }, { f: 784, g: 0.12, d: 0.12, at: 0.2, type: 'triangle' }], modes: [{ f: 784, q: 8, g: 0.08, d: 0.06 }] },
  // A cat's paw landing on the counter: a muffled, low-passed thump with no ring (never a ceramic tap).
  pat: { modes: [{ f: 160, q: 1, g: 0.2, d: 0.05 }], tail: { type: 'lowpass', f: 320, q: 0.7, g: 0.18, a: 0.004, d: 0.05 } },
  // The kitchen timer's bell: a clapper ringing a few times.
  bell: { tones: [{ f: 2100, g: 0.22, d: 1.2 }, { f: 5800, g: 0.07, d: 0.6 }, { f: 11340, g: 0.03, d: 0.3 }], repeat: { n: 4, gap: 0.07, jitter: 0.01, fall: 0.15 } },
  gulp: { tones: [{ f: 300, to: 140, g: 0.35, d: 0.1 }], tail: { type: 'lowpass', f: 500, q: 1.5, g: 0.2, d: 0.08 } },
  // Two small bells (each with its inharmonic 2.76x partial), kept under the crack's level.
  cheer: { tones: [{ f: 1568, g: 0.1, d: 0.5 }, { f: 4328, g: 0.03, d: 0.25 }, { f: 2093, g: 0.1, d: 0.6, at: 0.12 }, { f: 5777, g: 0.03, d: 0.3, at: 0.12 }] },
  squelch: { tail: { type: 'bandpass', f: 600, to: 1400, q: 1.5, g: 0.4, a: 0.01, d: 0.15 }, modes: [{ f: 350, q: 1.2, g: 0.2, d: 0.1 }] },
  splash: { tail: { type: 'lowpass', f: 2500, q: 1, g: 0.35, a: 0.005, d: 0.25 }, modes: [{ f: 500, q: 1.5, g: 0.2, d: 0.1 }], repeat: { n: 3, gap: 0.03, jitter: 0.02, fall: 0.3 } },
  // A drop into cream or batter: a low, soft, damped noise thud with no pitched sweep (not a bubble).
  drip: { modes: [{ f: 320, q: 1, g: 0.12, d: 0.04 }], tail: { type: 'lowpass', f: 600, q: 0.7, g: 0.14, a: 0.004, d: 0.05 } },
  steam: { tail: { type: 'highpass', f: 4500, q: 0.7, g: 0.2, a: 0.08, d: 0.6 } },
  // The white sliding off the shell after the yolk: a soft wet slap.
  slop: { tones: [{ f: 320, to: 120, g: 0.25, d: 0.1 }], tail: { type: 'lowpass', f: 700, q: 1.2, g: 0.3, a: 0.01, d: 0.12 } },
  // Something tiny and light on glass or ceramic (a cup lifted, whisk wires on the bowl).
  tink: { click: { g: 0.25, d: 0.002 }, modes: [{ f: 5200, q: 28, g: 0.18, d: 0.07 }, { f: 7600, q: 30, g: 0.08, d: 0.05 }] },
  clunk: { click: { g: 0.6, d: 0.006 }, modes: [{ f: 110, q: 6, g: 0.5, d: 0.14 }, { f: 330, q: 8, g: 0.2, d: 0.1 }], tail: { type: 'lowpass', f: 300, q: 1, g: 0.25, d: 0.1 } },
  // ---- the secret: smashing the scenery (smash.ts) ----
  // A swing landing: a hard click, a punchy low thock and a short crunchy mid tail. Its rate
  // follows what was hit (tiles and ceramic higher, the plant lower).
  whack: { click: { g: 0.9, d: 0.004 }, modes: [{ f: 180, q: 3, g: 0.6, d: 0.09 }, { f: 760, q: 5, g: 0.3, d: 0.06 }], tail: { type: 'bandpass', f: 1800, to: 900, q: 0.9, g: 0.35, a: 0.002, d: 0.09 } },
  // It gives: a low boom, a crunch and a rattle of bits.
  smash: { click: { g: 1, d: 0.008 }, tones: [{ f: 120, to: 45, g: 0.5, d: 0.25 }], tail: { type: 'lowpass', f: 3500, to: 600, q: 0.8, g: 0.55, a: 0.004, d: 0.35 }, repeat: { n: 5, gap: 0.045, jitter: 0.025, fall: 0.22 } },
  // A weak point hit: a bright two-note ding over the whack.
  crit: { tones: [{ f: 1760, g: 0.16, d: 0.12, type: 'triangle' }, { f: 2637, g: 0.14, d: 0.22, at: 0.05, type: 'triangle' }] },
  // Something rebuilding: three quick rising blips.
  // The cat, hit: a cross little mew (up, then down), a growl, and (on strike) a hiss.
  mew: { tones: [{ f: 620, to: 1050, g: 0.14, d: 0.1, type: 'triangle' }, { f: 1050, to: 560, g: 0.13, d: 0.22, at: 0.09, type: 'triangle' }] },
  growl: { tones: [{ f: 120, to: 95, g: 0.1, d: 0.5, type: 'sawtooth' }], tail: { type: 'lowpass', f: 420, q: 1.2, g: 0.16, a: 0.03, d: 0.45 } },
  hiss: { tail: { type: 'highpass', f: 3200, q: 0.7, g: 0.32, a: 0.03, d: 0.55 } },
  // Patted: a soft purr, a run of low rumbles.
  purr: { modes: [{ f: 95, q: 2, g: 0.22, d: 0.05 }], repeat: { n: 10, gap: 0.05, jitter: 0.005, fall: 0.06 } },
  build: { tones: [{ f: 660, g: 0.05, d: 0.06, type: 'square' }, { f: 880, g: 0.05, d: 0.06, at: 0.07, type: 'square' }, { f: 1175, g: 0.05, d: 0.1, at: 0.14, type: 'square' }] },
};

/** Synthesized loops: a filtered noise bed per sound (by ear), used when no recording is listed. */
const SYNTH_LOOPS: Record<LoopName, { type: BiquadFilterType; f: number; q: number; max: number }> = {
  whisk: { type: 'bandpass', f: 2200, q: 0.7, max: 0.35 },
  pour: { type: 'lowpass', f: 700, q: 0.5, max: 0.4 },
  glug: { type: 'lowpass', f: 420, q: 1.5, max: 0.4 },
  oven: { type: 'lowpass', f: 180, q: 0.8, max: 0.3 },
  flour: { type: 'lowpass', f: 900, q: 0.7, max: 0.25 },
  tick: { type: 'bandpass', f: 3000, q: 4, max: 0.4 },
  sizzle: { type: 'highpass', f: 5000, q: 0.7, max: 0.2 },
};

const jitter = (amount: number) => 1 + (Math.random() * 2 - 1) * amount;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

class Sound {
  muted = false;
  /** The last 200 sounds played, oldest first (for the test driver). */
  readonly log: SoundEvent[] = [];
  private ctx?: AudioContext;
  private master?: GainNode;
  private unlocked = false;
  private noise?: AudioBuffer;
  private crackle?: AudioBuffer;
  private ticks?: AudioBuffer;
  private takes: Partial<Record<SoundName, Take[]>> = {};
  private loopSamples: Partial<Record<LoopName, LoopSample>> = {};
  private live = new Set<{ name: LoopName; level: number }>();
  private last: Partial<Record<SoundName, { t: number; n: number; take: number }>> = {};

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* no storage: start unmuted */ }
    if (typeof AudioContext === 'undefined') return;
    // Created now so the recordings decode while the title card shows; it stays suspended
    // (silent) until unlock() resumes it from the Start tap.
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'running') void this.ctx.suspend();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.knee.value = 6;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(comp).connect(this.ctx.destination);
    void this.loadManifest();
  }

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    this.unlocked = true;
    // iOS: play through the silent switch like a game, not like a ringtone.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) try { session.type = 'playback'; } catch { /* older WebKit */ }
    this.wake();
  }

  /** Resume a context the OS suspended (iOS after a call, a tab switch). Safe to call often. */
  wake() {
    if (this.unlocked && this.ctx && this.ctx.state !== 'running') void this.ctx.resume().catch(() => {});
  }

  get state(): string { return this.ctx?.state ?? 'none'; }

  setMuted(m: boolean) {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* not remembered, still works */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.02);
  }

  /** Current level of every running Loop (the loudest when two share a name). */
  loops(): Partial<Record<LoopName, number>> {
    const out: Partial<Record<LoopName, number>> = {};
    for (const l of this.live) out[l.name] = Math.max(out[l.name] ?? 0, l.level);
    return out;
  }

  /** What was decoded: every one-shot name with its take count, then every recorded loop. */
  loaded(): { name: string; takes: number; loop?: true }[] {
    return [
      ...Object.entries(this.takes).map(([name, t]) => ({ name, takes: t!.length })),
      ...Object.keys(this.loopSamples).map((name) => ({ name, takes: 1, loop: true as const })),
    ];
  }

  /**
   * gain scales loudness; rate shifts pitch (1 = as recorded). Both get a little random
   * variation. delay (s) schedules it that much later on the audio clock, for layered hits.
   * Muted, nothing plays and nothing is logged.
   */
  play(name: SoundName, opts: { gain?: number; rate?: number; delay?: number } = {}) {
    if (!this.ctx || !this.master || !this.unlocked || this.muted) return;
    const now = this.ctx.currentTime + Math.max(0, opts.delay ?? 0);
    let gain = (opts.gain ?? 1) * jitter(0.15);
    let rate = (opts.rate ?? 1) * jitter(0.08);
    // Quick repeats (berries, chomps, drips) step their pitch so no two in a row are the same.
    const prev = this.last[name];
    const n = prev && now - prev.t < REPEAT_WINDOW ? prev.n + 1 : 0;
    if (n > 0) rate *= REPEAT_RATES[(n - 1) % REPEAT_RATES.length];
    const takes = this.takes[name];
    let take = -1;
    if (takes && takes.length) {
      // The takes rotate (from a random first one), so no two hits in a row are the same recording.
      take = prev && prev.take >= 0 ? (prev.take + 1) % takes.length : Math.floor(Math.random() * takes.length);
      const tk = takes[take];
      gain *= tk.gain;
      rate *= tk.rate;
      this.playBuffer(tk, gain, rate, now);
    } else {
      this.voice(VOICES[name], gain, rate, now);
    }
    this.last[name] = { t: now, n, take };
    this.record(name, take >= 0 ? 'sample' : 'synth', gain, rate, now);
  }

  /** A sustained sound: the recorded slice looped when the manifest has one, else synthesized. */
  loop(name: LoopName): Loop {
    if (!this.ctx || !this.master) return { set() {}, stop() {} };
    const ctx = this.ctx;
    const rec = this.loopSamples[name];
    const entry = { name, level: 0 };
    this.live.add(entry);
    if (!this.muted) this.record(`loop:${name}`, rec ? 'sample' : 'synth', 0, 1);

    const src = ctx.createBufferSource();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    g.gain.value = 0;
    let max: number;
    let hum: OscillatorNode | null = null;
    let humGain: GainNode | null = null;
    let lfo: OscillatorNode | null = null;
    // Amplitude modulation (the flour's grain): an LFO wobbling a gain node.
    let am: GainNode | null = null;
    const modulate = (hz: number, depth: number) => {
      am = ctx.createGain();
      am.gain.value = 1 - depth;
      lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = depth;
      lfo.connect(d).connect(am.gain);
      lfo.start();
    };
    if (rec) {
      src.buffer = rec.buffer;
      src.loopStart = 0;
      src.loopEnd = rec.buffer.duration;
      f.type = 'lowpass';
      f.frequency.value = 18000;
      max = rec.gain;
      // Start somewhere in the slice so two pours in a row don't begin identically.
      src.start(0, Math.random() * rec.buffer.duration);
      // flour is a soft hiss under 900 Hz at a quarter level; the glug is the thick oil pour a little
      // slower and low-passed: batter pouring is a soft, dull rush, nearly silent
      if (name === 'flour') { f.frequency.value = 900; max = SYNTH_LOOPS.flour.max * rec.norm; }
      if (name === 'glug') { src.playbackRate.value = GLUG_RATE; f.frequency.value = 900; }
    } else {
      const cfg = SYNTH_LOOPS[name];
      src.buffer = name === 'tick' ? this.ticksBuffer() : name === 'sizzle' ? this.crackleBuffer() : this.noiseBuffer();
      f.type = cfg.type;
      f.frequency.value = cfg.f;
      f.Q.value = cfg.q;
      max = cfg.max;
      src.start(0, name === 'tick' ? 0 : Math.random() * src.buffer.duration);
      if (name === 'oven') {
        hum = ctx.createOscillator();
        hum.type = 'triangle';
        hum.frequency.value = 55;
        humGain = ctx.createGain();
        humGain.gain.value = 0;
        hum.connect(humGain).connect(this.master);
        hum.start();
      }
    }
    // Flour through a sieve has a faint grain: a slow, shallow 8 Hz sway (deeper or faster is an
    // audible wobble or buzz). The pours get none: the recording carries its own movement.
    if (name === 'flour') modulate(8, 0.12);
    if (am) src.connect(f).connect(am).connect(g).connect(this.master);
    else src.connect(f).connect(g).connect(this.master);
    // The synthesized sizzle's crackles: little highpassed pops fired at the stage's rate, scaled by the level.
    let crackleAt = ctx.currentTime;

    let stopped = false;
    return {
      set: (level, extra = {}) => {
        if (stopped) return;
        const l = clamp01(level);
        entry.level = l;
        const t = ctx.currentTime;
        let amp = l * max;
        // The physics each loop follows (all by ear): a faster whisk is brighter and quicker,
        // the stroke's far side is a touch louder; a filling vessel rings higher; heat hums.
        if (name === 'whisk') {
          // a stroke pulse every half turn: the wires push the batter against the far wall twice a round
          if (extra.phase !== undefined) amp *= 1 + 0.4 * Math.sin(extra.phase * Math.PI * 4);
          src.playbackRate.setTargetAtTime(rec ? 0.85 + 0.3 * l : 1, t, 0.05);
          if (!rec) f.frequency.setTargetAtTime(1500 + l * 1800, t, 0.05);
        } else if (name === 'pour' || name === 'glug') {
          // a filling vessel rises a little in pitch, +5% from empty to full: thick liquid into
          // batter doesn't ring like water into glass
          const fill = clamp01(extra.fill ?? 0);
          const base = name === 'glug' ? GLUG_RATE : 1;
          src.playbackRate.setTargetAtTime(base * (1 + 0.05 * fill), t, 0.1);
          if (rec) f.frequency.setTargetAtTime(name === 'glug' ? 500 + 500 * l : 1500 + 16000 * l, t, 0.05);
        } else if (name === 'tick') {
          src.playbackRate.setTargetAtTime(extra.rate ?? 1, t, 0.05);
        } else if (name === 'sizzle') {
          // the recorded pan sizzle already spits; only the synthesized bed gets the extra pops
          const rate = rec ? 0 : CRACKLE[extra.stage ?? ''] ?? 0;
          if (crackleAt < t) crackleAt = t;
          while (rate > 0 && l > 0 && crackleAt < t + 0.1) {
            crackleAt += -Math.log(1 - Math.random()) / rate; // Poisson: crackles come unevenly, like fat spitting
            this.burst(crackleAt, 0.0005, 0.012 + Math.random() * 0.01, 'highpass', 2500, 0.8, (0.15 + 0.25 * Math.random()) * Math.max(0.3, l));
          }
        } else if (name === 'flour') {
          src.playbackRate.setTargetAtTime(0.9 + 0.2 * l, t, 0.05);
        } else if (name === 'oven') {
          const heat = clamp01(extra.heat ?? l);
          humGain?.gain.setTargetAtTime(heat * 0.12, t, 0.1);
          if (rec) src.playbackRate.setTargetAtTime(0.95 + 0.1 * heat, t, 0.2);
        }
        // a sound that stops (a let-go) dies in ~60 ms; one that swells eases in
        g.gain.setTargetAtTime(amp, t, l === 0 ? 0.02 : 0.05);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        entry.level = 0;
        this.live.delete(entry);
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        humGain?.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
        setTimeout(() => { src.stop(); hum?.stop(); (lfo as OscillatorNode | null)?.stop(); }, 400);
      },
    };
  }

  private record(name: string, kind: 'synth' | 'sample', gain: number, rate: number, at?: number) {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    this.log.push({ t: at ?? this.ctx?.currentTime ?? 0, name, kind, gain: r3(gain), rate: r3(rate) });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }

  // ---- recordings --------------------------------------------------------------------------

  private async loadManifest() {
    const ctx = this.ctx!;
    const base = `${import.meta.env.BASE_URL}sounds/`;
    let manifest: Manifest;
    try {
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) return;
      manifest = (await res.json()) as Manifest;
    } catch { return; /* no recordings: everything stays synthesized */ }
    // Each file is fetched and decoded once, all in parallel, however many slices use it.
    const files = new Map<string, Promise<AudioBuffer | null>>();
    const decode = (file: string) => {
      if (!files.has(file)) {
        files.set(file, fetch(base + file)
          .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
          .then((b) => ctx.decodeAudioData(b))
          .catch((e) => { console.warn(`sound: could not decode ${file} (${e?.message ?? e})`); return null; }));
      }
      return files.get(file)!;
    };
    const { loops = {}, ...shots } = manifest;
    await Promise.all([
      ...Object.entries(shots).map(async ([name, entries]) => {
        if (!(name in VOICES) || !Array.isArray(entries)) return;
        const takes = (await Promise.all(entries.map(async (e) => {
          const buffer = await decode(e.file);
          return buffer ? this.makeTake(buffer, e) : null;
        }))).filter((t): t is Take => !!t);
        if (takes.length) this.takes[name as SoundName] = takes;
      }),
      ...Object.entries(loops).map(async ([name, e]) => {
        if (!(name in SYNTH_LOOPS) || !e) return;
        const buffer = await decode(e.file);
        if (buffer) this.loopSamples[name as LoopName] = this.makeLoop(buffer, e);
      }),
    ]);
  }

  /** A take, normalized to a common peak so manifest gains compare like for like. */
  private makeTake(buffer: AudioBuffer, e: TakeEntry): Take {
    const start = Math.min(e.start ?? 0, buffer.duration);
    const dur = Math.min(e.dur ?? buffer.duration - start, buffer.duration - start);
    const peak = peakOf(buffer, start, start + dur);
    return { buffer, start, dur, gain: (e.gain ?? 1) * normFor(peak), rate: e.rate ?? 1 };
  }

  /**
   * The slice [start, end) baked into its own buffer whose seam is an equal-power crossfade of
   * the slice's tail into its head, so the plain loop flag plays it with no click or bump.
   */
  private makeLoop(buffer: AudioBuffer, e: LoopEntry): LoopSample {
    const sr = buffer.sampleRate;
    const a = Math.floor(Math.min(e.start, buffer.duration) * sr);
    const b = Math.max(a + 1, Math.floor(Math.min(e.end, buffer.duration) * sr));
    const x = Math.min(Math.floor(XFADE * sr), Math.floor((b - a) / 2));
    const n = b - a - x;
    const out = this.ctx!.createBuffer(buffer.numberOfChannels, n, sr);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < n; i++) dst[i] = src[a + i];
      for (let i = 0; i < x; i++) {
        const k = (i / x) * (Math.PI / 2);
        dst[i] = src[a + i] * Math.sin(k) + src[a + n + i] * Math.cos(k);
      }
    }
    const norm = normFor(peakOf(out, 0, out.duration));
    return { buffer: out, gain: (e.gain ?? 1) * norm, norm };
  }

  private playBuffer(tk: Take, gain: number, rate: number, at: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = tk.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    // A slice cut from a longer recording fades in and out over a few ms so it never clicks.
    const len = tk.dur / rate;
    const fade = Math.min(0.03, len / 4);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.003);
    g.gain.setValueAtTime(gain, at + len - fade);
    g.gain.linearRampToValueAtTime(0, at + len);
    src.connect(g).connect(this.master!);
    src.start(at, tk.start, tk.dur);
  }

  // ---- synthesis ---------------------------------------------------------------------------

  /** Two seconds of white noise; every burst plays a fresh 0.25 s of it from a random offset. */
  private noiseBuffer() {
    if (!this.noise) this.noise = this.fill(2, () => Math.random() * 2 - 1);
    return this.noise;
  }

  /** Sparse crackles for a sizzle: mostly quiet, with a pop every few ms. */
  private crackleBuffer() {
    if (!this.crackle) this.crackle = this.fill(2, () => (Math.random() < 0.004 ? Math.random() * 2 - 1 : (Math.random() * 2 - 1) * 0.04));
    return this.crackle;
  }

  /** A clockwork tick-tock, 0.5 s apart, for the timer loop. */
  private ticksBuffer() {
    if (!this.ticks) {
      const sr = this.ctx!.sampleRate;
      this.ticks = this.fill(1, (i) => {
        const t = (i / sr) % 0.5;
        const pitch = i / sr < 0.5 ? 3200 : 2600;
        return t < 0.012 ? Math.sin(t * pitch * Math.PI * 2) * Math.exp(-t * 500) : 0;
      });
    }
    return this.ticks;
  }

  private fill(seconds: number, fn: (i: number) => number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = fn(i);
    return buf;
  }

  /** A noise slice through a filter, shaped by an attack and an exponential decay. */
  private burst(at: number, a: number, d: number, type: BiquadFilterType, f: number, q: number, gain: number, to?: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    const len = Math.min(0.25, a + d + 0.02);
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, at);
    if (to) flt.frequency.exponentialRampToValueAtTime(to, at + a + d);
    flt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + Math.max(a, 0.001));
    g.gain.exponentialRampToValueAtTime(0.0005, at + a + d);
    src.connect(flt).connect(g).connect(this.master!);
    src.start(at, Math.random() * (src.buffer.duration - len), len);
  }

  private tone(at: number, t: Tone, gain: number, rate: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = t.type ?? 'sine';
    o.frequency.setValueAtTime(t.f * rate, at);
    if (t.to) o.frequency.exponentialRampToValueAtTime(t.to * rate, at + t.d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(t.g * gain, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0005, at + t.d);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + t.d + 0.02);
  }

  private voice(v: Voice, gain: number, rate: number, t0: number) {
    const nyquist = this.ctx!.sampleRate / 2;
    const r = v.repeat ?? { n: 1, gap: 0, jitter: 0, fall: 0 };
    let at = t0;
    for (let i = 0; i < r.n; i++) {
      const gi = gain * Math.max(0.1, 1 - i * r.fall);
      if (v.click) this.burst(at, 0.0005, v.click.d ?? 0.004, 'highpass', 1500, 0.7, v.click.g * gi);
      for (const m of v.modes ?? []) {
        const f = Math.min(m.f * rate, nyquist * 0.9);
        // A narrow band passes little noise; scale by its width so Q sets the ring, not the loudness.
        const comp = Math.min(40, Math.sqrt((nyquist * m.q) / f) * 0.35);
        this.burst(at, 0.001, m.d, 'bandpass', f * jitter(0.03), m.q, m.g * gi * comp);
      }
      if (v.tail) {
        const tl = v.tail;
        this.burst(at + (tl.at ?? 0), tl.a ?? 0.002, tl.d, tl.type, tl.f * rate, tl.q, tl.g * gi, tl.to ? tl.to * rate : undefined);
      }
      // Tones sound once, except a struck voice with no click (the bell) rings on every hit.
      if (i === 0 || !v.click) for (const tn of v.tones ?? []) this.tone(at + (tn.at ?? 0), tn, gi, rate);
      at += r.gap + Math.random() * r.jitter;
    }
  }
}

function peakOf(buffer: AudioBuffer, from: number, to: number) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(buffer.length, Math.ceil(to * sr));
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = a; i < b; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  }
  return peak;
}

/** Gain that brings a recording's peak to 0.9, so quiet and loud sources start level. */
function normFor(peak: number) {
  return peak > 0.001 ? Math.min(12, 0.9 / peak) : 1;
}

export const sound = new Sound();

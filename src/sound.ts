// Kitchen sounds. Recorded samples are the goal (see SPEC.md); until they are
// dropped into public/sounds/, each sound is synthesized so the feel can be tuned now.

export type SoundName = 'crack' | 'plop' | 'tap' | 'clink';

type Manifest = Partial<Record<SoundName, string[]>>;

class Sound {
  muted = false;
  private ctx?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private samples: Partial<Record<SoundName, AudioBuffer[]>> = {};
  private manifestLoaded = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    void this.loadSamples();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.02);
  }

  /** gain scales loudness; rate shifts pitch (1 = as recorded). Both get a little random variation. */
  play(name: SoundName, opts: { gain?: number; rate?: number } = {}) {
    if (!this.ctx || !this.master || this.muted) return;
    const gain = (opts.gain ?? 1) * (0.9 + Math.random() * 0.2);
    const rate = (opts.rate ?? 1) * (0.94 + Math.random() * 0.12);
    const bufs = this.samples[name];
    if (bufs && bufs.length) return this.playBuffer(bufs[Math.floor(Math.random() * bufs.length)], gain, rate);
    this.synth[name](gain, rate);
  }

  private async loadSamples() {
    if (this.manifestLoaded || !this.ctx) return;
    this.manifestLoaded = true;
    try {
      const base = `${import.meta.env.BASE_URL}sounds/`;
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) return;
      const manifest = (await res.json()) as Manifest;
      for (const [name, files] of Object.entries(manifest) as [SoundName, string[]][]) {
        const decoded: AudioBuffer[] = [];
        for (const f of files) {
          try {
            const buf = await (await fetch(base + f)).arrayBuffer();
            decoded.push(await this.ctx.decodeAudioData(buf));
          } catch { /* skip a bad file, keep the rest */ }
        }
        if (decoded.length) this.samples[name] = decoded;
      }
    } catch { /* no samples: synthesized sounds stay in use */ }
  }

  private playBuffer(buffer: AudioBuffer, gain: number, rate: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.master!);
    src.start();
  }

  // ---- synthesized fallbacks -------------------------------------------------

  private noiseBuffer() {
    const ctx = this.ctx!;
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /** A short burst of filtered noise: the building block of every "contact" sound. */
  private burst(at: number, dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private tone(at: number, dur: number, from: number, to: number, gain: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private synth: Record<SoundName, (gain: number, rate: number) => void> = {
    // Eggshell: three quick crisp snaps, then a soft low knock.
    crack: (gain, rate) => {
      const t = this.ctx!.currentTime;
      let at = t;
      for (let i = 0; i < 3; i++) {
        this.burst(at, 0.035, (2600 + Math.random() * 1600) * rate, 1.4, gain * (0.8 - i * 0.2));
        at += 0.018 + Math.random() * 0.025;
      }
      this.tone(t, 0.08, 170 * rate, 60, gain * 0.35);
    },
    // Yolk landing: a quick downward blip with a little splash.
    plop: (gain, rate) => {
      const t = this.ctx!.currentTime;
      this.tone(t, 0.12, 520 * rate, 110, gain * 0.5);
      this.burst(t + 0.01, 0.05, 900 * rate, 0.8, gain * 0.15, 'lowpass');
    },
    // Egg touching the rim gently.
    tap: (gain, rate) => {
      const t = this.ctx!.currentTime;
      this.burst(t, 0.02, 1800 * rate, 2, gain * 0.2);
      this.tone(t, 0.03, 900 * rate, 600, gain * 0.1);
    },
    // Shell half landing on the counter.
    clink: (gain, rate) => {
      const t = this.ctx!.currentTime;
      this.burst(t, 0.03, 3600 * rate, 1.5, gain * 0.18, 'highpass');
    },
  };
}

export const sound = new Sound();

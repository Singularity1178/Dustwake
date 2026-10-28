export class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  noiseBuf: AudioBuffer | null = null;
  hum: { g: GainNode; o: OscillatorNode[] } | null = null;

  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { return; }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.ambient();
  }

  private env(g: GainNode, t: number, a: number, peak: number, dcy: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dcy);
  }

  tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0) {
    const c = this.ctx; if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, 0.01, vol, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur: number, vol: number, filter: BiquadFilterType, freq: number, q = 1, delay = 0, freqTo?: number) {
    const c = this.ctx; if (!c || !this.master || !this.noiseBuf) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    const g = c.createGain();
    this.env(g, t, 0.005, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  step(heavy: boolean) {
    this.tone(heavy ? 52 : 64, 0.18, "sine", heavy ? 0.5 : 0.3, 30);
    this.noise(heavy ? 0.12 : 0.22, heavy ? 0.14 : 0.08, "lowpass", heavy ? 380 : 900, 1);
  }
  scrape() { this.noise(0.25, 0.12, "bandpass", 1400, 3, 0, 700); }
  pickup() { this.tone(520, 0.25, "triangle", 0.15); this.tone(780, 0.4, "triangle", 0.12, undefined, 0.09); }
  place() { this.tone(140, 0.15, "square", 0.08, 70); this.noise(0.1, 0.15, "bandpass", 2200, 2); }
  open() { this.noise(0.35, 0.1, "bandpass", 500, 4, 0, 250); this.tone(90, 0.3, "sawtooth", 0.04, 60); }
  unlock() { [0, 0.12, 0.3].forEach((d, i) => this.tone(1800 + i * 300, 0.06, "square", 0.05, 900, d)); this.noise(0.5, 0.1, "bandpass", 300, 3, 0.35, 150); }
  clank() { this.tone(330, 0.3, "square", 0.06, 120); this.tone(660, 0.5, "triangle", 0.06, 400, 0.05); this.noise(0.15, 0.12, "highpass", 3000, 1); }
  smash() {
    this.tone(45, 0.8, "sine", 0.7, 25);
    this.noise(1.2, 0.45, "lowpass", 1200, 1, 0, 120);
    for (let i = 0; i < 6; i++) this.noise(0.08, 0.15, "bandpass", 1500 + Math.random() * 2000, 4, 0.2 + Math.random() * 0.9);
  }
  thud() { this.tone(70, 0.25, "sine", 0.35, 40); this.noise(0.15, 0.1, "lowpass", 600); }
  /** Gear on (the basket onto the back): a soft wicker creak and a quiet strap tap. */
  strap() { this.noise(0.14, 0.05, "bandpass", 1500, 3, 0, 900); this.tone(180, 0.09, "triangle", 0.035, 140, 0.06); }
  /** Gear off: the same, reversed. */
  unstrap() { this.tone(150, 0.08, "triangle", 0.03, 190); this.noise(0.12, 0.045, "bandpass", 900, 3, 0.04, 1500); }
  /** The slam: both arms heave up (a low grind), swing down (a whoosh), land (a deep ground thud). */
  slamWindup() { this.tone(55, 0.4, "sawtooth", 0.03, 85); this.noise(0.35, 0.04, "lowpass", 300, 1); }
  slamSwing() { this.noise(0.12, 0.08, "bandpass", 700, 1.2, 0, 180); }
  slam() { this.tone(48, 0.45, "sine", 0.55, 28); this.noise(0.3, 0.2, "lowpass", 700, 1, 0, 120); }
  /** A blow that doesn't break what it hits: a hard stone crack and a dull boom, shorter than smash(). */
  impact() {
    this.tone(60, 0.5, "sine", 0.5, 34);
    this.noise(0.45, 0.3, "lowpass", 1400, 1, 0, 200);
    for (let i = 0; i < 3; i++) this.noise(0.06, 0.14, "bandpass", 1800 + Math.random() * 1500, 4, 0.05 + i * 0.07);
  }
  spark() { for (let i = 0; i < 3; i++) this.noise(0.03, 0.06, "highpass", 4000 + Math.random() * 3000, 1, i * 0.04); }
  clink() { this.tone(2400 + Math.random() * 400, 0.08, "square", 0.04, 1800); this.noise(0.05, 0.08, "highpass", 5000); }
  drip(vol: number) { if (vol > 0.02) this.tone(1200 + Math.random() * 600, 0.12, "sine", 0.12 * vol, 500); }
  rumble() { this.noise(3, 0.22, "lowpass", 140, 1, 0, 60); this.tone(35, 2.5, "sine", 0.3, 28); }
  fizzle() {
    this.tone(400, 0.6, "sawtooth", 0.08, 60);
    for (let i = 0; i < 8; i++) this.noise(0.05, 0.1, "highpass", 3000, 1, i * 0.07);
  }
  insight() { [392, 494, 587, 740].forEach((f, i) => this.tone(f, 1.2, "sine", 0.07, undefined, i * 0.12)); }
  activate() {
    [196, 247, 294, 392, 494].forEach((f, i) => this.tone(f, 2.5, "triangle", 0.07, undefined, i * 0.25));
    this.noise(3, 0.12, "bandpass", 200, 2, 0, 1600);
  }
  teleport() {
    this.tone(110, 3.5, "sawtooth", 0.08, 1760);
    this.tone(220, 3.5, "sine", 0.1, 2200);
    this.noise(3.5, 0.25, "bandpass", 300, 1.5, 0, 6000);
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 2.5, "sine", 0.08, undefined, 3.2 + i * 0.1));
  }
  boot() {
    this.tone(60, 1.5, "sawtooth", 0.06, 220);
    this.tone(880, 0.4, "sine", 0.05, 1320, 1.4);
  }

  // ---- inner monologue: cold, quiet machine sounds, nothing like the guardian's voice
  /** A thought begins: a faint falling double blip. */
  thoughtStart() { this.tone(1760, 0.03, "sine", 0.018); this.tone(1320, 0.04, "sine", 0.014, undefined, 0.05); }
  /** One typed character of a thought: a tiny high tick (lower and softer for the "void" tone). */
  thoughtTick(low = false) { this.tone((low ? 520 : 1250) + Math.random() * 180, 0.018, "square", low ? 0.006 : 0.008); }
  /** Diagnostics running: a short random data chirp. */
  chirp() { this.tone(900 + Math.random() * 900, 0.025, "square", 0.01, 600 + Math.random() * 1400); }
  /** Diagnostics finished: two settling tones. */
  diagDone() { this.tone(988, 0.12, "triangle", 0.04); this.tone(659, 0.3, "triangle", 0.035, undefined, 0.11); }
  /** An empty, low swell under a line that is about an absence. */
  hollow() { this.tone(82, 2.2, "sine", 0.06, 73); this.tone(123, 2.0, "triangle", 0.012, 110, 0.15); }
  /** Control handed to the player at the end of a cutscene: a soft, open "ready" tone. */
  online() { this.tone(392, 0.5, "sine", 0.035); this.tone(587, 0.7, "sine", 0.03, undefined, 0.08); }

  // ---- vision mode: heard hundreds of times a session, so short, soft and never shrill
  /** The eye switches to its scanner: a low iris thump, a rising sweep and an airy whoosh, ending on a tiny lock blip. */
  visionOn() {
    this.tone(120, 0.08, "sine", 0.05, 70);
    this.tone(440, 0.16, "sine", 0.03, 1320);
    this.noise(0.2, 0.018, "bandpass", 1500, 1.5, 0, 6000);
    this.tone(1320, 0.06, "triangle", 0.012, undefined, 0.13);
  }
  /** Back to plain sight: the sweep falling away. */
  visionOff() {
    this.tone(1100, 0.12, "sine", 0.024, 360);
    this.noise(0.1, 0.012, "bandpass", 3000, 1.5, 0, 800);
  }
  /** The sweep finds something: one quiet sonar tick, pitched by category; something still to analyze answers with a second, higher tick. */
  visionPing(category: string, pending: boolean, n: number) {
    const f = ({ important: 1568, buildable: 1319, interactable: 1175, npc: 988 } as Record<string, number>)[category] ?? 1175;
    const vol = 0.012 * Math.max(0.45, 1 - n * 0.07);
    this.tone(f, 0.06, "sine", vol);
    if (pending) this.tone(f * 1.5, 0.07, "sine", vol * 0.75, undefined, 0.045);
  }
  /** Analysis begins: a soft rising read tone. */
  scanStart() { this.tone(330, 0.25, "triangle", 0.018, 660); this.noise(0.3, 0.012, "bandpass", 900, 4, 0, 2400); }
  /** Analysis in progress: a tiny data tick, climbing with progress k (0..1). */
  scanTick(k: number) { this.tone(700 + 900 * k, 0.025, "square", 0.006); }
  /** Analysis complete: a bright three-note arpeggio with a shimmer on top. */
  analyzed() {
    [784, 1175, 1568].forEach((f, i) => this.tone(f, 0.4, "sine", 0.035, undefined, i * 0.055));
    this.tone(2349, 0.6, "triangle", 0.01, undefined, 0.16);
    this.noise(0.25, 0.015, "highpass", 6000, 1, 0.12);
  }

  /** Dialogue typewriter: one soft, low blip per character (a weary voice: low and a little uneven). */
  blip() { this.tone(300 + Math.random() * 50, 0.045, "triangle", 0.03, 260); }
  /** The golem's eye is mended: an electrical crackle that resolves into a clear rising chime. */
  eyeRepair() {
    for (let i = 0; i < 12; i++) this.noise(0.02 + Math.random() * 0.04, 0.08, "highpass", 2500 + Math.random() * 5000, 1, i * 0.045 + Math.random() * 0.03);
    this.tone(70, 0.55, "sawtooth", 0.045, 160);
    this.noise(0.55, 0.05, "bandpass", 1200, 5, 0, 5000);
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 1.1, "sine", 0.06, undefined, 0.55 + i * 0.09));
    this.tone(1046, 1.6, "triangle", 0.03, 1568, 0.9);
  }
  /** A dormant golem sputters awake: a low rising buzz, sparks, a faint ready tone. */
  wakeSputter() {
    this.tone(40, 1.2, "sawtooth", 0.05, 120);
    for (let i = 0; i < 6; i++) this.noise(0.03, 0.06, "highpass", 3500 + Math.random() * 3000, 1, 0.1 + i * 0.13 + Math.random() * 0.05);
    this.tone(520, 0.35, "sine", 0.04, 780, 1.0);
  }
  /** Powering down: a falling tone and a settling thud. */
  powerDown() {
    this.tone(260, 1.4, "sine", 0.05, 60);
    this.tone(130, 1.2, "sawtooth", 0.025, 40);
    this.tone(70, 0.3, "sine", 0.3, 40, 1.1);
    this.noise(0.2, 0.08, "lowpass", 500, 1, 1.1);
  }

  /** A core seated in a golem's hatch: the latch, then (if it powers the body) a rising hum and a small ready blip; too weak, a hum that sags. */
  coreIn(powers: boolean) {
    this.tone(220, 0.08, "square", 0.05, 110); this.noise(0.06, 0.08, "bandpass", 2200, 4);
    if (powers) { this.tone(70, 0.9, "sawtooth", 0.035, 180, 0.08); this.tone(660, 0.18, "triangle", 0.035, 880, 0.75); }
    else { this.tone(70, 0.7, "sawtooth", 0.03, 110, 0.08); this.tone(110, 0.6, "sawtooth", 0.025, 50, 0.5); }
  }
  /** A core drawn out: the latch, the hum falling away (only if the body ran on it). */
  coreOut(powered: boolean) {
    this.tone(180, 0.08, "square", 0.05, 260); this.noise(0.06, 0.08, "bandpass", 1800, 4);
    if (powered) { this.tone(180, 0.8, "sawtooth", 0.03, 50, 0.06); this.tone(70, 0.2, "sine", 0.2, 40, 0.8); }
  }

  setHum(level: number) {
    const c = this.ctx; if (!c || !this.master) return;
    if (!this.hum) {
      const g = c.createGain(); g.gain.value = 0; g.connect(this.master);
      const o = [98, 98.6, 147].map((f) => {
        const os = c.createOscillator(); os.type = "sine"; os.frequency.value = f; os.connect(g); os.start(); return os;
      });
      this.hum = { g, o };
    }
    this.hum.g.gain.setTargetAtTime(level * 0.08, c.currentTime, 0.3);
  }

  private ambient() {
    const c = this.ctx!;
    const g = c.createGain(); g.gain.value = 0.05; g.connect(this.master!);
    const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 180; f.connect(g);
    for (const fr of [41, 41.4, 61.5]) {
      const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start();
    }
    const lfo = c.createOscillator(); lfo.frequency.value = 0.05;
    const lg = c.createGain(); lg.gain.value = 80; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    // wind through cracks
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const wf = c.createBiquadFilter(); wf.type = "bandpass"; wf.frequency.value = 500; wf.Q.value = 0.8;
    const wg = c.createGain(); wg.gain.value = 0.018;
    const wl = c.createOscillator(); wl.frequency.value = 0.08; const wlg = c.createGain(); wlg.gain.value = 0.014;
    wl.connect(wlg); wlg.connect(wg.gain); wl.start();
    s.connect(wf); wf.connect(wg); wg.connect(this.master!); s.start();
  }
}

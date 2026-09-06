// WebAudio 合成音效：零外部资源（沿用黑冰惯例），静音状态存 localStorage
let ctx: AudioContext | null = null;
let muted = localStorage.getItem('zd_mute') === '1';

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.04, delay = 0, slide = 0): void {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  get muted() {
    return muted;
  },
  toggle(): boolean {
    muted = !muted;
    localStorage.setItem('zd_mute', muted ? '1' : '0');
    return muted;
  },
  select() {
    tone(560, 0.05, 'square', 0.025);
  },
  unsel() {
    tone(410, 0.05, 'square', 0.02);
  },
  launch() {
    tone(300, 0.12, 'triangle', 0.05, 0, 220);
  },
  tick(i: number) {
    tone(430 + i * 70, 0.07, 'square', 0.045);
  },
  implant() {
    tone(210, 0.1, 'sawtooth', 0.04);
    tone(315, 0.12, 'sawtooth', 0.03, 0.06);
  },
  slam() {
    tone(120, 0.22, 'sawtooth', 0.07, 0, -60);
    tone(240, 0.18, 'square', 0.04);
  },
  destroy() {
    [0, 0.07, 0.14].forEach((d, i) => tone(300 - i * 80, 0.16, 'sawtooth', 0.06, d, -80));
    tone(90, 0.4, 'sawtooth', 0.08, 0.2, -50);
  },
  coin() {
    tone(920, 0.07, 'square', 0.04);
    tone(1380, 0.12, 'square', 0.04, 0.07);
  },
  buy() {
    tone(620, 0.06, 'square', 0.04);
    tone(930, 0.1, 'square', 0.04, 0.06);
  },
  discard() {
    tone(340, 0.08, 'triangle', 0.03, 0, -120);
  },
  hurt() {
    tone(170, 0.32, 'sawtooth', 0.06, 0, -90);
  },
  win() {
    [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'square', 0.05, i * 0.11));
  },
};

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noise(ac: AudioContext, duration: number, gain: number): AudioBufferSourceNode {
  const buf = ac.createBuffer(1, ac.sampleRate * duration, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * gain;
  const src = ac.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Short card flick */
export function playCardDeal() {
  const ac = getCtx();
  const t = ac.currentTime;

  // filtered noise burst = card flick
  const src = noise(ac, 0.08, 0.6);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(3000, t);
  filter.frequency.exponentialRampToValueAtTime(800, t + 0.06);
  filter.Q.value = 1.5;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.01, t + 0.08);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.08);
}

/** Chip toss / bet */
export function playChipBet() {
  const ac = getCtx();
  const t = ac.currentTime;

  // two quick metallic taps
  for (let i = 0; i < 2; i++) {
    const offset = i * 0.06;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2800 + i * 600, t + offset);
    osc.frequency.exponentialRampToValueAtTime(1200, t + offset + 0.04);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.15, t + offset);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.06);
    osc.connect(g).connect(ac.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.06);
  }
}

/** Check / tap */
export function playCheck() {
  const ac = getCtx();
  const t = ac.currentTime;

  // two quick knocks
  for (let i = 0; i < 2; i++) {
    const offset = i * 0.1;
    const src = noise(ac, 0.03, 0.5);
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.3, t + offset);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.03);
    src.connect(filter).connect(g).connect(ac.destination);
    src.start(t + offset);
    src.stop(t + offset + 0.03);
  }
}

/** Fold — soft whoosh */
export function playFold() {
  const ac = getCtx();
  const t = ac.currentTime;

  const src = noise(ac, 0.2, 0.4);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1500, t);
  filter.frequency.exponentialRampToValueAtTime(300, t + 0.2);
  filter.Q.value = 0.8;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.2);
}

/** Win chime */
export function playWin() {
  const ac = getCtx();
  const t = ac.currentTime;

  const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
  notes.forEach((freq, i) => {
    const offset = i * 0.1;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.15, t + offset);
    g.gain.linearRampToValueAtTime(0.15, t + offset + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.35);
    osc.connect(g).connect(ac.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.35);
  });
}

/** Button click — subtle */
export function playClick() {
  const ac = getCtx();
  const t = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(800, t + 0.03);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.04);
}

/** Community card reveal (flop/turn/river) */
export function playCardFlip() {
  const ac = getCtx();
  const t = ac.currentTime;

  // slightly different from deal — more of a snap
  const src = noise(ac, 0.1, 0.5);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(4000, t);
  filter.frequency.exponentialRampToValueAtTime(1000, t + 0.08);
  filter.Q.value = 2;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.1);

  // subtle tonal accent
  const osc = ac.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(600, t + 0.06);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.06, t);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g2).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.08);
}

/** All-in dramatic sound */
export function playAllIn() {
  const ac = getCtx();
  const t = ac.currentTime;

  // rapid chip cascade
  for (let i = 0; i < 5; i++) {
    const offset = i * 0.04;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(2000 + i * 400, t + offset);
    osc.frequency.exponentialRampToValueAtTime(1000, t + offset + 0.05);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.12, t + offset);
    g.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.06);
    osc.connect(g).connect(ac.destination);
    osc.start(t + offset);
    osc.stop(t + offset + 0.06);
  }
}

/** New hand starting */
export function playNewHand() {
  const ac = getCtx();
  const t = ac.currentTime;

  // shuffle-like noise burst
  const src = noise(ac, 0.3, 0.3);
  const filter = ac.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(2000, t);
  filter.frequency.setValueAtTime(3000, t + 0.1);
  filter.frequency.setValueAtTime(2000, t + 0.2);
  filter.Q.value = 1;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.15, t);
  g.gain.setValueAtTime(0.2, t + 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  src.connect(filter).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.3);
}

/** Your turn notification */
export function playYourTurn() {
  const ac = getCtx();
  const t = ac.currentTime;

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, t);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.08);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.2);

  const osc2 = ac.createOscillator();
  osc2.type = "sine";
  osc2.frequency.setValueAtTime(1100, t + 0.12);
  const g2 = ac.createGain();
  g2.gain.setValueAtTime(0.12, t + 0.12);
  g2.gain.linearRampToValueAtTime(0.12, t + 0.2);
  g2.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc2.connect(g2).connect(ac.destination);
  osc2.start(t + 0.12);
  osc2.stop(t + 0.35);
}

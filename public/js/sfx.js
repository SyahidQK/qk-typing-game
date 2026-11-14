// Synthesised sound, no audio files. Everything routes through buses
// (ui / race / stinger) into a master gain and a safety limiter, and all
// levels are set in decibels.
const dbToGain = (db) => Math.pow(10, db / 20);
const BUS_DB = { ui: -14, race: -12, stinger: -7 };
const MASTER_DB = -6;

let ctx = null;
let master = null;
const buses = {};
let muted = false;
try { muted = localStorage.getItem('ks_muted') === '1'; } catch (e) { /* storage blocked */ }

function init() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = muted ? 0 : dbToGain(MASTER_DB);
  master.connect(limiter);
  for (const name of Object.keys(BUS_DB)) {
    buses[name] = ctx.createGain();
    buses[name].gain.value = dbToGain(BUS_DB[name]);
    buses[name].connect(master);
  }
  return true;
}

function tone({ freq, to, dur = 0.12, type = 'sine', bus = 'ui', db = 0, at = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  const peak = dbToGain(db);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(buses[bus]);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// small random pitch offset so repeated sounds do not feel mechanical
const vary = (f, amount = 0.06) => f * (1 + (Math.random() * 2 - 1) * amount);

export const sfx = {
  unlock() { if (init() && ctx.state === 'suspended') ctx.resume(); },
  get muted() { return muted; },
  setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('ks_muted', muted ? '1' : '0'); } catch (e) { /* storage blocked */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : dbToGain(MASTER_DB), ctx.currentTime, 0.02);
  },
  tick() { tone({ freq: 440, dur: 0.16, type: 'triangle', bus: 'stinger' }); },
  go() {
    tone({ freq: 880, dur: 0.5, type: 'triangle', bus: 'stinger' });
    tone({ freq: 1320, dur: 0.5, type: 'sine', bus: 'stinger', db: -6 });
  },
  word() { tone({ freq: vary(1250), dur: 0.035, type: 'sine', bus: 'race', db: -8 }); },
  error() { tone({ freq: vary(150), to: 95, dur: 0.09, type: 'square', bus: 'race', db: -6 }); },
  join() { tone({ freq: 620, to: 930, dur: 0.14, type: 'sine', bus: 'ui' }); },
  ready() { tone({ freq: 520, dur: 0.07, bus: 'ui' }); tone({ freq: 780, dur: 0.1, bus: 'ui', at: 0.07 }); },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'triangle', bus: 'stinger', at: i * 0.09 })); },
  rankUp() { tone({ freq: 700, to: 1100, dur: 0.18, type: 'triangle', bus: 'ui' }); },
  drum() { tone({ freq: 190, to: 55, dur: 0.32, type: 'sine', bus: 'stinger', db: 3 }); },
  win() {
    [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) =>
      tone({ freq: f, dur: 0.3, type: 'triangle', bus: 'stinger', at: i * 0.12 }));
  }
};

window.addEventListener('pointerdown', sfx.unlock, { passive: true });
window.addEventListener('keydown', sfx.unlock);

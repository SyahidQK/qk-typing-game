import { esc, ordinal } from './ui.js';
import { motionOK, runLoop } from './fx.js';

const IDLE_AFTER_MS = 700;  // no progress for this long: the racer slows to a stop
const BASE_CPS = 5;         // 60 wpm plays the run animation at normal speed

// Race track: one lane per player. Lanes are keyed by player id so the
// racers glide between updates instead of being rebuilt. Each racer hops
// along at a pace that follows how fast its player is typing right now.
export function createTrack(el) {
  const lanes = new Map(); // id -> { el, cap, lastP, lastT, cps, anim }

  function build(p) {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.innerHTML =
      '<span class="lane-no"></span>' +
      '<span class="lane-name"></span>' +
      '<div class="lane-road"><div class="racer"><span class="racer-cap"></span></div></div>' +
      '<span class="lane-stat"></span>';
    lane.querySelector('.lane-name').textContent = p.name;
    const cap = lane.querySelector('.racer-cap');
    cap.textContent = p.avatar;
    lane.style.setProperty('--c', p.color);
    el.appendChild(lane);
    return { el: lane, cap, lastP: p.progress, lastT: performance.now(), cps: 0, anim: null };
  }

  function applyPace(L, active) {
    const running = active && L.cps > 0.4;
    L.el.classList.toggle('is-running', running);
    if (!motionOK()) return;
    if (running) {
      if (!L.anim) L.anim = runLoop(L.cap);
      L.anim.playbackRate = Math.min(2.6, Math.max(0.4, L.cps / BASE_CPS));
      if (L.anim.playState !== 'running') L.anim.play();
    } else if (L.anim) {
      L.anim.cancel();
      L.anim = null;
    }
  }

  // racers that stop typing wind down even when no update arrives
  const timer = setInterval(() => {
    const now = performance.now();
    for (const L of lanes.values()) {
      if (L.cps > 0 && now - L.lastT > IDLE_AFTER_MS) {
        L.cps = L.cps < 0.8 ? 0 : L.cps * 0.5;
        applyPace(L, !L.el.classList.contains('is-done') && !L.el.classList.contains('is-off'));
      }
    }
  }, 250);

  return {
    update(state, meId) {
      const len = Math.max(1, state.text.length);
      const now = performance.now();
      const seen = new Set();
      for (const p of state.players) {
        seen.add(p.id);
        let L = lanes.get(p.id);
        if (!L) { L = build(p); lanes.set(p.id, L); }
        if (p.progress > L.lastP) {
          const inst = Math.min(16, (p.progress - L.lastP) / Math.max(0.12, (now - L.lastT) / 1000));
          L.cps = L.cps ? L.cps * 0.55 + inst * 0.45 : inst;
          L.lastT = now;
        }
        L.lastP = p.progress;
        const lane = L.el;
        lane.querySelector('.lane-no').textContent = p.lane;
        lane.style.setProperty('--p', Math.min(1, p.progress / len).toFixed(4));
        lane.classList.toggle('is-me', p.id === meId);
        lane.classList.toggle('is-off', !p.connected);
        lane.classList.toggle('is-done', p.finished);
        lane.querySelector('.lane-stat').innerHTML = p.finished
          ? '<b>' + esc(ordinal(p.place)) + '</b> ' + p.wpm + ' wpm'
          : p.wpm + ' wpm';
        applyPace(L, state.phase === 'racing' && !p.finished && p.connected);
      }
      for (const [id, L] of lanes) {
        if (!seen.has(id)) { if (L.anim) L.anim.cancel(); L.el.remove(); lanes.delete(id); }
      }
    },
    reset() {
      for (const L of lanes.values()) if (L.anim) L.anim.cancel();
      el.innerHTML = '';
      lanes.clear();
    },
    destroy() { clearInterval(timer); }
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
}

export function fmtTime(ms) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
}

// One screen visible at a time; focus moves to the screen's main control so
// the whole flow works from the keyboard.
let current = null;
export function showScreen(id) {
  if (current === id) return false;
  current = id;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  const focusEl = document.querySelector('#' + id + ' [data-autofocus]');
  if (focusEl) setTimeout(() => focusEl.focus(), 30);
  return true;
}

// 3 · 2 · 1 · Go overlay driven by the server-aligned clock.
export function createCountdown(el, clock, sfx) {
  const num = $('.cd-num', el);
  let timer = 0, startAt = 0, last = null, fired = false, onGo = null;

  function frame() {
    const rem = startAt - clock.now();
    let label = null;
    if (rem > 0) {
      const n = Math.ceil(rem / 1000);
      label = n > 3 ? 'Get ready' : String(n);
    } else {
      if (!fired) { fired = true; if (onGo) onGo(); }
      if (rem > -800) label = 'Go!';
    }
    if (label === null) { stop(); return; }
    if (label !== last) {
      const wasCounting = last !== null;
      last = label;
      el.hidden = false;
      num.textContent = label;
      num.classList.toggle('is-words', label.length > 1);
      num.classList.remove('pop');
      void num.offsetWidth;
      num.classList.add('pop');
      if (label === 'Go!') { if (wasCounting) sfx.go(); }
      else if (label !== 'Get ready') sfx.tick();
    }
  }

  function stop() {
    clearInterval(timer);
    timer = 0;
    el.hidden = true;
  }

  return {
    start(at, cb) {
      stop();
      startAt = at; onGo = cb; last = null; fired = false;
      timer = setInterval(frame, 40);
      frame();
    },
    stop
  };
}

// Leaderboard whose rows slide from their previous rank to the new one
// while the score counts up.
const ROW_H = 56;
export function renderLeaderboard(el, players, { meId = null, animate = true, showGain = true } = {}) {
  const sorted = [...players].sort((a, b) => a.rank - b.rank);
  el.innerHTML = '';
  el.style.height = sorted.length * ROW_H + 'px';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const move = animate && !reduce;
  const rows = sorted.map((p) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (p.id === meId ? ' is-me' : '') + (p.rank <= 3 ? ' is-top' : '');
    row.style.setProperty('--c', p.color);
    row.innerHTML =
      '<span class="lb-rank">' + p.rank + '</span>' +
      '<span class="lb-cap">' + esc(p.avatar) + '</span>' +
      '<span class="lb-name">' + esc(p.name) + '</span>' +
      (showGain ? '<span class="lb-wpm">' + p.wpm + ' wpm</span><span class="lb-gain">+' + p.roundPoints + '</span>' : '') +
      '<span class="lb-total">' + (move ? p.total - p.roundPoints : p.total) + '</span>';
    row.style.transform = 'translateY(' + ((move ? p.prevRank : p.rank) - 1) * ROW_H + 'px)';
    el.appendChild(row);
    return { row, p };
  });
  if (!move) return;
  setTimeout(() => {
    const t0 = performance.now();
    for (const { row, p } of rows) {
      row.style.transform = 'translateY(' + (p.rank - 1) * ROW_H + 'px)';
      if (p.rank < p.prevRank) row.classList.add('is-up');
    }
    const from = rows.map(({ p }) => p.total - p.roundPoints);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      rows.forEach(({ row, p }, i) => {
        const total = row.querySelector('.lb-total');
        if (total) total.textContent = Math.round(from[i] + (p.total - from[i]) * k);
      });
      if (k < 1) setTimeout(step, 30);
    };
    step();
  }, 900);
}

export function bindMute(btn, sfx) {
  const paint = () => {
    btn.textContent = sfx.muted ? 'Sound off' : 'Sound on';
    btn.setAttribute('aria-pressed', String(!sfx.muted));
  };
  btn.addEventListener('click', () => { sfx.setMuted(!sfx.muted); paint(); });
  paint();
}

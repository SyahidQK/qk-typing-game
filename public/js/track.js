import { esc, ordinal } from './ui.js';

// Race track: one lane per player. Lanes are keyed by player id so the
// racers glide between updates instead of being rebuilt.
export function createTrack(el) {
  const lanes = new Map();

  function build(p) {
    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.innerHTML =
      '<span class="lane-no"></span>' +
      '<span class="lane-name"></span>' +
      '<div class="lane-road"><div class="racer"><span class="racer-cap"></span></div></div>' +
      '<span class="lane-stat"></span>';
    lane.querySelector('.lane-name').textContent = p.name;
    lane.querySelector('.racer-cap').textContent = p.avatar;
    lane.style.setProperty('--c', p.color);
    el.appendChild(lane);
    return lane;
  }

  return {
    update(state, meId) {
      const len = Math.max(1, state.text.length);
      const seen = new Set();
      for (const p of state.players) {
        seen.add(p.id);
        let lane = lanes.get(p.id);
        if (!lane) { lane = build(p); lanes.set(p.id, lane); }
        lane.querySelector('.lane-no').textContent = p.lane;
        lane.style.setProperty('--p', Math.min(1, p.progress / len).toFixed(4));
        lane.classList.toggle('is-me', p.id === meId);
        lane.classList.toggle('is-off', !p.connected);
        lane.classList.toggle('is-done', p.finished);
        lane.querySelector('.lane-stat').innerHTML = p.finished
          ? '<b>' + esc(ordinal(p.place)) + '</b> ' + p.wpm + ' wpm'
          : p.wpm + ' wpm';
      }
      for (const [id, lane] of lanes) {
        if (!seen.has(id)) { lane.remove(); lanes.delete(id); }
      }
    },
    reset() { el.innerHTML = ''; lanes.clear(); }
  };
}

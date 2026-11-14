/* global io */
import { $, esc, fmtTime, showScreen, createCountdown, renderLeaderboard, bindMute } from './ui.js';
import { createClock } from './clock.js';
import { createTrack } from './track.js';
import { sfx } from './sfx.js';

const PW_KEY = 'ks_host';
const socket = io();
const clock = createClock(socket);
const countdown = createCountdown($('#countdown'), clock, sfx);
const track = createTrack($('#track'));
bindMute($('#mute'), sfx);

let authed = false;
let state = null;
let texts = [];
let raceRound = 0;
let resultRound = 0;
let finalShown = false;
let lastCount = 0;
let revealTimers = [];

let password = null;
try { password = sessionStorage.getItem(PW_KEY); } catch (e) { /* storage blocked */ }

// ---------- sign in ----------
function login(pw, onError) {
  socket.emit('admin:login', { password: pw }, (r) => {
    if (!r || r.error) {
      authed = false;
      try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* storage blocked */ }
      password = null;
      showScreen('s-login');
      if (onError) onError((r && r.error) || 'Could not sign in.');
      return;
    }
    authed = true;
    password = pw;
    try { sessionStorage.setItem(PW_KEY, pw); } catch (e) { /* storage blocked */ }
    texts = r.texts || [];
    paintTexts();
    if (!r.hasGame) showScreen('s-create');
  });
}

socket.on('connect', () => {
  $('#conn').hidden = true;
  if (password) login(password); else showScreen('s-login');
});
socket.on('disconnect', () => { $('#conn').hidden = false; });
socket.on('state', (s) => { if (authed) { state = s; render(); } });

$('#login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  $('#login-err').textContent = '';
  login($('#pw').value, (msg) => { $('#login-err').textContent = msg; });
});

// ---------- create ----------
function createGame() {
  socket.emit('admin:create', (r) => {
    if (r && r.ok) { texts = r.texts; paintTexts(); resetLocal(); }
  });
}
function resetLocal() {
  raceRound = 0; resultRound = 0; finalShown = false; lastCount = 0;
  revealTimers.forEach(clearTimeout); revealTimers = [];
  $('#confetti').innerHTML = '';
  track.reset();
}
$('#create-btn').addEventListener('click', createGame);
$('#new-btn').addEventListener('click', () => {
  if (confirm('Open a new game? The current results will be cleared.')) createGame();
});

// ---------- lobby ----------
function paintTexts() {
  $('#texts-fields').innerHTML = texts.map((t, i) =>
    '<label for="text-' + i + '">Round ' + (i + 1) + '</label>' +
    '<textarea id="text-' + i + '" rows="4" spellcheck="false">' + esc(t) + '</textarea>').join('');
}
$('#texts-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const next = texts.map((_, i) => $('#text-' + i).value);
  socket.emit('admin:setTexts', { texts: next }, (r) => {
    const msg = $('#texts-msg');
    if (r && r.ok) { texts = r.texts; paintTexts(); msg.textContent = 'Texts saved'; msg.classList.remove('is-err'); }
    else { msg.textContent = (r && r.error) || 'Could not save.'; msg.classList.add('is-err'); }
  });
});

function start(force) {
  $('#lobby-err').textContent = '';
  socket.emit('admin:start', { force }, (r) => {
    if (r && r.error) $('#lobby-err').textContent = r.error;
  });
}
$('#start-btn').addEventListener('click', () => start(false));
$('#force-btn').addEventListener('click', () => start(true));

$('#slots').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kick]');
  if (!btn) return;
  if (confirm('Remove ' + btn.dataset.name + ' from the game?')) socket.emit('admin:kick', { id: btn.dataset.kick });
});

function renderLobby() {
  showScreen('s-lobby');
  $('#join-url').textContent = location.host;
  $('#pin-big').innerHTML = state.pin.split('').map((d) => '<span class="is-filled">' + d + '</span>').join('');
  const n = state.players.length;
  const ready = state.players.filter((p) => p.ready).length;
  $('#roster-count').textContent = n === 0
    ? 'Waiting for racers'
    : n + ' of ' + state.maxPlayers + ' racers in · ' + ready + ' ready';
  let html = '';
  for (let i = 0; i < state.maxPlayers; i++) {
    const p = state.players[i];
    if (!p) { html += '<li class="slot is-empty"><span>Lane ' + (i + 1) + '</span></li>'; continue; }
    html += '<li class="slot' + (p.ready ? ' is-ready' : '') + (p.connected ? '' : ' is-off') + '" style="--c:' + p.color + '">' +
      '<span class="slot-cap">' + esc(p.avatar) + '</span>' +
      '<span class="slot-name">' + esc(p.name) + '</span>' +
      '<span class="slot-state">' + (!p.connected ? 'Offline' : p.ready ? 'Ready' : 'Not ready') + '</span>' +
      '<button type="button" class="slot-kick" data-kick="' + p.id + '" data-name="' + esc(p.name) + '" aria-label="Remove ' + esc(p.name) + '">×</button>' +
      '</li>';
  }
  $('#slots').innerHTML = html;
  $('#start-btn').disabled = !state.allReady;
  $('#force-btn').hidden = n === 0 || state.allReady;
  if (n > lastCount) sfx.join();
  lastCount = n;
}

// ---------- race ----------
$('#end-btn').addEventListener('click', () => {
  if (confirm('End this round now? Racers who have not finished are ranked by progress.')) socket.emit('admin:endRound');
});

function renderRace() {
  showScreen('s-race');
  if (raceRound !== state.round) {
    raceRound = state.round;
    track.reset();
    countdown.start(state.startAt, null);
  }
  $('#hud-round').textContent = state.round + ' of ' + state.rounds;
  $('#hud-done').textContent = state.players.filter((p) => p.finished).length + ' of ' + state.players.length;
  track.update(state, null);
}
setInterval(() => {
  if (state && state.phase === 'racing') $('#hud-time').textContent = fmtTime(clock.now() - state.startAt);
}, 100);

// ---------- results ----------
$('#next-btn').addEventListener('click', () => socket.emit('admin:next'));

function renderResults() {
  const fresh = showScreen('s-results') || resultRound !== state.round;
  if (!fresh) return;
  resultRound = state.round;
  countdown.stop();
  $('#res-eyebrow').textContent = 'Round ' + state.round + ' of ' + state.rounds;
  const winner = state.players.find((p) => p.place === 1 && p.finished);
  $('#res-title').textContent = winner
    ? winner.name + ' took the round at ' + winner.wpm + ' wpm'
    : 'Nobody crossed the line';
  renderLeaderboard($('#res-lb'), state.players, {});
  $('#next-btn').textContent = 'Start round ' + (state.round + 1);
  setTimeout(() => sfx.rankUp(), 1000);
}

// ---------- final ----------
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#FFD23F', '#FF5D5D', '#3DDC97', '#F5F2FF', '#7CC6FE'];
  let html = '';
  for (let i = 0; i < 70; i++) {
    html += '<i style="left:' + (Math.random() * 100).toFixed(1) + '%;background:' + colors[i % colors.length] +
      ';animation-delay:' + (Math.random() * 1.6).toFixed(2) + 's;animation-duration:' + (2.6 + Math.random() * 2).toFixed(2) + 's"></i>';
  }
  $('#confetti').innerHTML = html;
}

function renderFinal() {
  showScreen('s-final');
  if (finalShown) return;
  finalShown = true;
  countdown.stop();
  const top = [...state.players].sort((a, b) => a.rank - b.rank).slice(0, 3);
  $('#fin-title').textContent = 'And the winners are…';
  $('#fin-lb').hidden = true;
  $('#new-btn').hidden = true;
  // visual order on the podium: 2nd, 1st, 3rd
  $('#podium').innerHTML = [1, 0, 2].filter((i) => top[i]).map((i) => {
    const p = top[i];
    return '<div class="pod pod-' + (i + 1) + '" style="--c:' + p.color + '">' +
      '<div class="pod-who"><span class="pod-cap">' + esc(p.avatar) + '</span>' +
      '<b>' + esc(p.name) + '</b><i>' + p.total.toLocaleString() + ' pts</i></div>' +
      '<div class="pod-block">' + (i + 1) + '</div></div>';
  }).join('');
  const reveal = (rank, at, sound) => revealTimers.push(setTimeout(() => {
    const el = $('.pod-' + rank);
    if (el) { el.classList.add('show'); sound(); }
  }, at));
  reveal(3, 1500, sfx.drum);
  reveal(2, 3500, sfx.drum);
  reveal(1, 6000, () => {
    sfx.win();
    confetti();
    if (top[0]) $('#fin-title').textContent = top[0].name + ' wins the sprint';
  });
  revealTimers.push(setTimeout(() => {
    $('#fin-lb').hidden = false;
    renderLeaderboard($('#fin-lb'), state.players, { animate: false, showGain: false });
    $('#new-btn').hidden = false;
  }, 8500));
}

function render() {
  if (!state) return;
  if (state.phase === 'lobby') {
    if (raceRound || finalShown) resetLocal();
    renderLobby();
  } else if (state.phase === 'racing') renderRace();
  else if (state.phase === 'results') renderResults();
  else if (state.phase === 'final') renderFinal();
}

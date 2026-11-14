/* global io */
import { $, esc, ordinal, fmtTime, showScreen, createCountdown, renderLeaderboard, bindMute } from './ui.js';
import { createClock } from './clock.js';
import { createTyping } from './typing.js';
import { createTrack } from './track.js';
import { sfx } from './sfx.js';

const TOKEN_KEY = 'ks_token';
const SEND_MS = 150;
const FINAL_REVEAL_MS = 9000; // keep phones quiet while the host screen reveals the podium

const socket = io();
const clock = createClock(socket);
const countdown = createCountdown($('#countdown'), clock, sfx);
const track = createTrack($('#track'));
bindMute($('#mute'), sfx);

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
let meId = null;
let state = null;
let pin = '';
let typing = null;
let raceRound = 0;
let resultRound = 0;
let finalAt = 0;
let lastCount = 0;
let pendingSend = false;

const pinInput = $('#pin');
const typeInput = $('#type-input');

function saveToken(t) {
  token = t;
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ }
}

function leave(message) {
  saveToken(null);
  meId = null; state = null; raceRound = 0; resultRound = 0; finalAt = 0;
  countdown.stop();
  if (typing) { typing.destroy(); typing = null; }
  track.reset();
  pinInput.value = '';
  paintPin();
  $('#pin-err').textContent = message || '';
  showScreen('s-pin');
}

// ---------- connection ----------
socket.on('connect', () => {
  $('#conn').hidden = true;
  if (!token) { if (!meId) showScreen(pin ? 's-name' : 's-pin'); return; }
  socket.emit('player:resume', { token }, (r) => {
    if (r && r.ok) meId = r.id;
    else leave('That game has ended. Enter a new PIN to join.');
  });
});
socket.on('disconnect', () => { $('#conn').hidden = false; });
socket.on('kicked', () => leave('The host removed you from the game.'));
socket.on('closed', () => leave('That game has ended. Enter a new PIN to join.'));
socket.on('replaced', () => {
  meId = null; state = null;
  $('#pin-err').textContent = 'This game is now open in another tab on this device.';
  showScreen('s-pin');
});
socket.on('state', (s) => { state = s; render(); });

// ---------- PIN ----------
function paintPin() {
  const caps = $('#pin-caps').children;
  const v = pinInput.value;
  for (let i = 0; i < caps.length; i++) {
    caps[i].textContent = v[i] || '';
    caps[i].classList.toggle('is-filled', i < v.length);
    caps[i].classList.toggle('is-active', i === Math.min(v.length, caps.length - 1));
  }
}
pinInput.addEventListener('input', () => {
  pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 6);
  $('#pin-err').textContent = '';
  paintPin();
});
$('#pin-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = pinInput.value;
  if (v.length !== 6) { $('#pin-err').textContent = 'The PIN has 6 digits.'; return; }
  socket.emit('player:checkPin', { pin: v }, (r) => {
    if (!r || r.error) { $('#pin-err').textContent = (r && r.error) || 'Could not reach the game. Try again.'; return; }
    pin = v;
    $('#name-err').textContent = '';
    showScreen('s-name');
  });
});
const urlPin = new URLSearchParams(location.search).get('pin');
if (urlPin && /^\d{6}$/.test(urlPin)) pinInput.value = urlPin;
paintPin();

// ---------- nickname ----------
$('#name-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#name').value.trim();
  if (!name) { $('#name-err').textContent = 'Enter a nickname.'; return; }
  socket.emit('player:join', { pin, name }, (r) => {
    if (!r || r.error) { $('#name-err').textContent = (r && r.error) || 'Could not join. Try again.'; return; }
    meId = r.id;
    saveToken(r.token);
    sfx.join();
    if (state) render();
  });
});
$('#back-pin').addEventListener('click', () => { pin = ''; showScreen('s-pin'); });

// ---------- lobby ----------
$('#ready-btn').addEventListener('click', () => {
  const me = self();
  if (!me) return;
  socket.emit('player:ready', { ready: !me.ready });
  if (!me.ready) sfx.ready();
});

const self = () => (state && meId ? state.players.find((p) => p.id === meId) : null);

function renderLobby(me) {
  showScreen('s-lobby');
  const cap = $('#lobby-cap');
  cap.textContent = me.avatar;
  cap.style.setProperty('--c', me.color);
  $('#lobby-title').textContent = "You're in, " + me.name;
  const ready = state.players.filter((p) => p.ready).length;
  $('#lobby-status').textContent = me.ready
    ? ready + ' of ' + state.players.length + ' ready. The host starts the race when everyone is in.'
    : 'Lane ' + me.lane + ' is yours. Press ready when your hands are on the keyboard.';
  const btn = $('#ready-btn');
  btn.textContent = me.ready ? 'Ready ✓  (press to undo)' : "I'm ready";
  btn.classList.toggle('is-on', me.ready);
  $('#lobby-players').innerHTML = state.players.map((p) =>
    '<li class="chip' + (p.ready ? ' is-ready' : '') + (p.connected ? '' : ' is-off') + '" style="--c:' + p.color + '">' +
    '<span class="chip-cap">' + esc(p.avatar) + '</span>' + esc(p.name) +
    (p.id === meId ? ' <em>you</em>' : '') + '</li>').join('');
  if (state.players.length > lastCount && lastCount > 0) sfx.join();
  lastCount = state.players.length;
}

// ---------- race ----------
function sendProgress() {
  if (!typing) return;
  pendingSend = false;
  socket.emit('player:progress', typing.stats());
}
setInterval(() => { if (pendingSend) sendProgress(); }, SEND_MS);

function startRace(me) {
  raceRound = state.startAt;
  if (typing) typing.destroy();
  track.reset();
  typeInput.disabled = true;
  $('#finish-note').hidden = true;
  typing = createTyping({
    text: state.text,
    textEl: $('#copy'),
    inputEl: typeInput,
    onProgress: () => { pendingSend = true; },
    onWord: () => sfx.word(),
    onError: () => sfx.error(),
    onFinish: () => {
      sendProgress();
      typeInput.disabled = true;
      sfx.finish();
    }
  });
  typing.restore(me.progress, me.finished);
  $('#copy').scrollTop = 0;
  countdown.start(state.startAt, () => {
    if (!typing || typing.finished) return;
    typeInput.disabled = false;
    typeInput.focus();
  });
}

function renderRace(me) {
  showScreen('s-race');
  if (raceRound !== state.startAt) startRace(me);
  $('#hud-round').textContent = state.round + ' of ' + state.rounds;
  track.update(state, meId);
  const note = $('#finish-note');
  if (me.finished) {
    typeInput.disabled = true;
    note.hidden = false;
    note.innerHTML = '<b>' + esc(ordinal(me.place)) + ' across the line</b> at ' + me.wpm +
      ' wpm in ' + fmtTime(me.timeMs) + '. Waiting for the other racers.';
  }
}

setInterval(() => {
  const me = self();
  if (!state || state.phase !== 'racing' || !me || !typing) return;
  const elapsed = me.finished ? me.timeMs : clock.now() - state.startAt;
  $('#hud-time').textContent = fmtTime(Math.max(0, elapsed));
  const st = typing.stats();
  $('#hud-wpm').textContent = me.finished ? me.wpm
    : (elapsed > 1000 ? Math.round((st.chars / 5) / (elapsed / 60000)) : 0);
  $('#hud-acc').textContent = st.keystrokes
    ? Math.round(((st.keystrokes - Math.min(st.errors, st.keystrokes)) / st.keystrokes) * 100) : 100;
}, 100);

document.addEventListener('click', (e) => {
  if (state && state.phase === 'racing' && !typeInput.disabled && !e.target.closest('button')) typeInput.focus();
});

// ---------- results ----------
function stat(label, value) {
  return '<div class="stat"><span>' + label + '</span><b>' + value + '</b></div>';
}

function renderResult(me) {
  const fresh = showScreen('s-result') || resultRound !== state.startAt;
  if (!fresh) return;
  resultRound = state.startAt;
  countdown.stop();
  $('#res-eyebrow').textContent = 'Round ' + state.round + ' of ' + state.rounds;
  $('#res-place').textContent = me.finished ? ordinal(me.place) + ' place' : 'Out of time';
  $('#res-stats').innerHTML =
    stat('Speed', me.wpm + ' wpm') +
    stat('Accuracy', me.accuracy + '%') +
    stat('Time', me.finished ? fmtTime(me.timeMs) : 'Not finished') +
    stat('Points', '+' + me.roundPoints);
  renderLeaderboard($('#res-lb'), state.players, { meId });
  $('#res-wait').textContent = 'Round ' + (state.round + 1) + ' starts when the host is ready. Shake out your hands.';
  if (me.rank < me.prevRank) setTimeout(() => sfx.rankUp(), 1000);
}

function renderFinal(me) {
  showScreen('s-final');
  countdown.stop();
  if (!finalAt) {
    finalAt = Date.now();
    setTimeout(() => { if (state && state.phase === 'final') render(); }, FINAL_REVEAL_MS + 50);
  }
  if (Date.now() - finalAt < FINAL_REVEAL_MS) return;
  if (!$('#fin-lb').hidden) return;
  $('#fin-title').textContent = 'You finished ' + ordinal(me.rank);
  $('#fin-sub').textContent = me.total.toLocaleString() + ' points across ' + state.rounds + ' rounds. Thanks for racing.';
  $('#fin-lb').hidden = false;
  renderLeaderboard($('#fin-lb'), state.players, { meId, animate: false, showGain: false });
  if (me.rank <= 3) sfx.win();
}

function render() {
  const me = self();
  if (!me) return;
  if (state.phase !== 'final') {
    finalAt = 0;
    $('#fin-lb').hidden = true;
    $('#fin-title').textContent = 'Eyes on the big screen';
    $('#fin-sub').textContent = 'The podium is being revealed.';
  }
  if (state.phase === 'lobby') { raceRound = 0; resultRound = 0; renderLobby(me); }
  else if (state.phase === 'racing') renderRace(me);
  else if (state.phase === 'results') renderResult(me);
  else if (state.phase === 'final') renderFinal(me);
}

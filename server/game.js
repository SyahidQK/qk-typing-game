'use strict';
const crypto = require('crypto');

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐙', '🦉', '🐨', '🦄', '🐧', '🐝'];
const COLORS = ['#FFD23F', '#FF7A7A', '#3DDC97', '#7CC6FE', '#FF9F1C', '#C9A7FF', '#F78FB3', '#9BE564', '#5EEAD4', '#FFB4A2'];
const MAX_CPS = 25; // 300 WPM: nobody at the event types faster than this
const NAME_MAX = 15;

const positionPoints = (place) => Math.max(100, 1000 - 100 * (place - 1));

function normalizeText(s) {
  return String(s || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

function genPin() {
  return String(crypto.randomInt(100000, 1000000));
}

class Game {
  constructor(opts = {}) {
    this.now = opts.now || Date.now;
    this.maxPlayers = opts.maxPlayers ?? 10;
    this.countdownMs = opts.countdownMs ?? 4000;
    this.roundCapMs = opts.roundCapMs ?? 5 * 60 * 1000;
    this.texts = (opts.texts || []).map(normalizeText);
    this.pin = opts.pin || genPin();
    this.phase = 'lobby'; // lobby | racing | results | final
    this.round = 0; // 1-based once started
    this.startAt = 0;
    this.capAt = 0;
    this.finishCount = 0;
    this.seq = 0;
    this.players = new Map();
  }

  get rounds() { return this.texts.length; }
  get text() { return this.round > 0 ? this.texts[this.round - 1] : ''; }

  setTexts(texts) {
    if (this.phase !== 'lobby') return { error: 'Texts can only be changed in the lobby.' };
    if (!Array.isArray(texts) || texts.length < 1 || texts.length > 10) return { error: 'Provide between 1 and 10 round texts.' };
    const clean = texts.map(normalizeText);
    if (clean.some((t) => t.length < 10)) return { error: 'Every round needs a text of at least 10 characters.' };
    if (clean.some((t) => t.length > 3000)) return { error: 'Round texts are limited to 3000 characters.' };
    this.texts = clean;
    return { ok: true };
  }

  addPlayer(rawName) {
    if (this.phase !== 'lobby') return { error: 'This game has already started.' };
    if (this.players.size >= this.maxPlayers) return { error: 'This game is full.' };
    const name = String(rawName || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!name) return { error: 'Enter a nickname.' };
    const lower = name.toLowerCase();
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === lower) return { error: 'That nickname is taken. Try another.' };
    }
    const used = new Set([...this.players.values()].map((p) => p.look));
    let look = 0;
    while (used.has(look)) look++;
    const player = {
      id: crypto.randomBytes(6).toString('hex'),
      token: crypto.randomBytes(18).toString('hex'),
      seq: this.seq++,
      look,
      name,
      avatar: AVATARS[look % AVATARS.length],
      color: COLORS[look % COLORS.length],
      ready: false,
      connected: true,
      total: 0,
      totalTimeMs: 0,
      rank: 0,
      prevRank: 0,
      // per round
      progress: 0, keystrokes: 0, errors: 0,
      finished: false, timeMs: 0, wpm: 0, accuracy: 1, place: 0, roundPoints: 0
    };
    this.players.set(player.id, player);
    this._rerank(false);
    return { ok: true, player };
  }

  removePlayer(id) {
    const had = this.players.delete(id);
    if (had) this._rerank(false);
    return had;
  }

  playerByToken(token) {
    if (!token) return null;
    for (const p of this.players.values()) if (p.token === token) return p;
    return null;
  }

  setReady(id, ready) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby') return false;
    p.ready = !!ready;
    return true;
  }

  allReady() {
    const live = [...this.players.values()].filter((p) => p.connected);
    return live.length > 0 && live.every((p) => p.ready);
  }

  startRound({ force = false } = {}) {
    if (this.phase !== 'lobby' && this.phase !== 'results') return { error: 'A round cannot start right now.' };
    if (this.players.size === 0) return { error: 'No players have joined yet.' };
    if (this.phase === 'lobby' && !force && !this.allReady()) return { error: 'Not every player is ready.' };
    if (this.round >= this.rounds) return { error: 'All rounds have been played.' };
    this.round++;
    this.phase = 'racing';
    this.startAt = this.now() + this.countdownMs;
    this.capAt = this.startAt + this.roundCapMs;
    this.finishCount = 0;
    for (const p of this.players.values()) {
      p.progress = 0; p.keystrokes = 0; p.errors = 0;
      p.finished = false; p.timeMs = 0; p.wpm = 0; p.accuracy = 1; p.place = 0; p.roundPoints = 0;
    }
    return { ok: true };
  }

  updateProgress(id, chars, keystrokes, errors) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'racing' || p.finished) return { ignored: true };
    const elapsed = this.now() - this.startAt;
    if (elapsed < 0) return { ignored: true };
    const len = this.text.length;
    chars = Math.floor(Number(chars));
    if (!Number.isFinite(chars) || chars < 0) return { ignored: true };
    chars = Math.min(chars, len);
    if (chars > (elapsed / 1000) * MAX_CPS + 5) return { ignored: true, tooFast: true };
    p.progress = chars;
    const ks = Math.floor(Number(keystrokes));
    const er = Math.floor(Number(errors));
    if (Number.isFinite(ks) && ks >= 0) p.keystrokes = ks;
    if (Number.isFinite(er) && er >= 0) p.errors = er;
    if (chars === len) {
      p.finished = true;
      p.timeMs = Math.max(1, elapsed);
      p.place = ++this.finishCount;
      p.wpm = Math.round((len / 5) / (p.timeMs / 60000));
      p.accuracy = this._accuracy(p);
    }
    return { ok: true, finished: p.finished, allDone: this.allDone() };
  }

  allDone() {
    if (this.phase !== 'racing') return false;
    const live = [...this.players.values()].filter((p) => p.connected);
    return this.finishCount > 0 && live.every((p) => p.finished);
  }

  _accuracy(p) {
    const ks = Math.max(p.keystrokes, p.progress, 1);
    const er = Math.min(Math.max(p.errors, 0), ks);
    return (ks - er) / ks;
  }

  endRound() {
    if (this.phase !== 'racing') return { error: 'No round is running.' };
    const elapsed = Math.max(1, Math.min(this.now(), this.capAt) - this.startAt);
    const all = [...this.players.values()];
    const unfinished = all.filter((p) => !p.finished).sort((a, b) => b.progress - a.progress || a.seq - b.seq);
    let place = this.finishCount;
    for (const p of unfinished) {
      p.place = ++place;
      p.timeMs = 0;
      p.wpm = Math.round((p.progress / 5) / (elapsed / 60000));
      p.accuracy = this._accuracy(p);
    }
    for (const p of all) {
      if (p.finished) {
        p.roundPoints = positionPoints(p.place) + Math.round(p.accuracy * 100);
        p.totalTimeMs += p.timeMs;
      } else {
        p.roundPoints = p.progress > 0 ? positionPoints(p.place) : 0;
        p.totalTimeMs += this.roundCapMs;
      }
      p.total += p.roundPoints;
    }
    this._rerank(true);
    this.phase = this.round >= this.rounds ? 'final' : 'results';
    return { ok: true };
  }

  _rerank(keepPrev) {
    const sorted = [...this.players.values()].sort(
      (a, b) => b.total - a.total || a.totalTimeMs - b.totalTimeMs || a.seq - b.seq
    );
    sorted.forEach((p, i) => {
      p.prevRank = keepPrev && p.rank ? p.rank : i + 1;
      p.rank = i + 1;
    });
  }

  publicState() {
    const now = this.now();
    const elapsed = now - this.startAt;
    const players = [...this.players.values()].sort((a, b) => a.seq - b.seq).map((p, i) => ({
      id: p.id, lane: i + 1, name: p.name, avatar: p.avatar, color: p.color,
      ready: p.ready, connected: p.connected,
      progress: p.progress, finished: p.finished, timeMs: p.timeMs,
      wpm: this.phase === 'racing' && !p.finished
        ? (elapsed > 1000 ? Math.round((p.progress / 5) / (elapsed / 60000)) : 0)
        : p.wpm,
      accuracy: Math.round(p.accuracy * 1000) / 10,
      place: p.place, roundPoints: p.roundPoints,
      total: p.total, rank: p.rank, prevRank: p.prevRank
    }));
    return {
      pin: this.pin, phase: this.phase, round: this.round, rounds: this.rounds,
      maxPlayers: this.maxPlayers, allReady: this.allReady(),
      startAt: this.startAt, capAt: this.capAt, serverNow: now,
      text: this.text, players
    };
  }
}

module.exports = { Game, normalizeText, positionPoints, MAX_CPS };

'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game } = require('./game');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const ROOM = 'game';
const TICK_MS = 150;
const END_DELAY_MS = 1800; // let the last finisher see their result before the board

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.disable('x-powered-by');
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

let currentTexts = require('./texts');
let game = null;
let dirty = false;
let capTimer = null;
let endTimer = null;
const sockets = new Map(); // playerId -> socket

const fn = (ack) => (typeof ack === 'function' ? ack : () => {});

function broadcast() {
  dirty = false;
  if (game) io.to(ROOM).emit('state', game.publicState());
}
setInterval(() => { if (dirty) broadcast(); }, TICK_MS);

function clearTimers() {
  clearTimeout(capTimer); clearTimeout(endTimer);
  capTimer = endTimer = null;
}

function endRoundNow() {
  clearTimers();
  if (game && game.phase === 'racing') { game.endRound(); broadcast(); }
}

function scheduleEndIfDone() {
  if (game && game.allDone() && !endTimer) endTimer = setTimeout(endRoundNow, END_DELAY_MS);
}

function startRound(force, redo = false) {
  const r = redo ? game.redoRound() : game.startRound({ force });
  if (r.ok) {
    clearTimers();
    capTimer = setTimeout(endRoundNow, game.capAt - Date.now() + 50);
    broadcast();
  }
  return r;
}

function attach(socket, player) {
  const old = sockets.get(player.id);
  if (old && old !== socket) {
    old.data.playerId = null;
    old.leave(ROOM);
    old.emit('replaced');
  }
  sockets.set(player.id, socket);
  socket.data.playerId = player.id;
  socket.join(ROOM);
  player.connected = true;
}

function detachAllPlayers() {
  for (const s of sockets.values()) { s.data.playerId = null; s.leave(ROOM); s.emit('closed'); }
  sockets.clear();
}

io.on('connection', (socket) => {
  socket.on('time:sync', (ack) => fn(ack)(Date.now()));

  // ---------- players ----------
  socket.on('player:checkPin', (msg, ack) => {
    ack = fn(ack);
    const now = Date.now();
    const d = socket.data;
    if (!d.pinWindow || now - d.pinWindow > 60000) { d.pinWindow = now; d.pinTries = 0; }
    if (++d.pinTries > 20) return ack({ error: 'Too many attempts. Wait a minute and try again.' });
    if (!game) return ack({ error: 'No game is open yet. Ask the host for the PIN.' });
    if (String(msg && msg.pin) !== game.pin) return ack({ error: 'That PIN does not match a game. Check the big screen.' });
    if (game.phase !== 'lobby') return ack({ error: 'This game has already started.' });
    ack({ ok: true });
  });

  socket.on('player:join', (msg, ack) => {
    ack = fn(ack);
    if (!game || String(msg && msg.pin) !== game.pin) return ack({ error: 'That PIN does not match a game.' });
    const r = game.addPlayer(msg.name);
    if (r.error) return ack(r);
    attach(socket, r.player);
    ack({ ok: true, id: r.player.id, token: r.player.token });
    broadcast();
  });

  socket.on('player:resume', (msg, ack) => {
    ack = fn(ack);
    const p = game && game.playerByToken(msg && msg.token);
    if (!p) return ack({ error: 'gone' });
    attach(socket, p);
    ack({ ok: true, id: p.id });
    broadcast();
  });

  socket.on('player:ready', (msg) => {
    if (game && socket.data.playerId && game.setReady(socket.data.playerId, msg && msg.ready)) broadcast();
  });

  socket.on('player:progress', (msg) => {
    if (!game || !socket.data.playerId || !msg) return;
    const r = game.updateProgress(socket.data.playerId, msg.chars, msg.keystrokes, msg.errors);
    if (!r.ok) return;
    if (r.finished) { broadcast(); scheduleEndIfDone(); } else dirty = true;
  });

  // ---------- admin ----------
  const admin = (handler) => (msg, ack) => {
    if (typeof msg === 'function') { ack = msg; msg = {}; }
    ack = fn(ack);
    if (!socket.data.admin) return ack({ error: 'Sign in as host first.' });
    handler(msg || {}, ack);
  };

  socket.on('admin:login', (msg, ack) => {
    ack = fn(ack);
    if (!msg || String(msg.password) !== ADMIN_PASSWORD) return ack({ error: 'Wrong host password.' });
    socket.data.admin = true;
    socket.join(ROOM);
    ack({ ok: true, hasGame: !!game, texts: game ? game.texts : currentTexts });
    if (game) socket.emit('state', game.publicState());
  });

  socket.on('admin:create', admin((msg, ack) => {
    clearTimers();
    detachAllPlayers();
    game = new Game({ texts: currentTexts });
    ack({ ok: true, texts: game.texts });
    broadcast();
  }));

  socket.on('admin:setTexts', admin((msg, ack) => {
    if (!game) return ack({ error: 'Create a game first.' });
    const r = game.setTexts(msg.texts);
    if (r.ok) { currentTexts = game.texts; broadcast(); }
    ack(r.ok ? { ok: true, texts: game.texts } : r);
  }));

  socket.on('admin:kick', admin((msg, ack) => {
    if (!game || !game.removePlayer(msg.id)) return ack({ error: 'Player not found.' });
    const s = sockets.get(msg.id);
    if (s) { s.data.playerId = null; s.leave(ROOM); s.emit('kicked'); sockets.delete(msg.id); }
    ack({ ok: true });
    broadcast();
    scheduleEndIfDone();
  }));

  socket.on('admin:start', admin((msg, ack) => {
    if (!game) return ack({ error: 'Create a game first.' });
    ack(startRound(!!msg.force));
  }));

  socket.on('admin:next', admin((msg, ack) => {
    if (!game || game.phase !== 'results') return ack({ error: 'The next round is not available yet.' });
    ack(startRound(true));
  }));

  socket.on('admin:redo', admin((msg, ack) => {
    if (!game) return ack({ error: 'Create a game first.' });
    ack(startRound(true, true));
  }));

  socket.on('admin:endRound', admin((msg, ack) => {
    if (!game || game.phase !== 'racing') return ack({ error: 'No round is running.' });
    endRoundNow();
    ack({ ok: true });
  }));

  socket.on('disconnect', () => {
    const id = socket.data.playerId;
    if (!id || !game || sockets.get(id) !== socket) return;
    sockets.delete(id);
    const p = game.players.get(id);
    if (p) {
      p.connected = false;
      if (game.phase === 'lobby') p.ready = false;
      broadcast();
      scheduleEndIfDone();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Typing race running on http://localhost:${PORT}  (host screen: /admin)`);
  if (!process.env.ADMIN_PASSWORD) console.log('ADMIN_PASSWORD is not set: using the development default. Set it before the event.');
});

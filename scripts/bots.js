'use strict';
// Fills a lobby with simulated racers so you can rehearse the whole flow.
//   node scripts/bots.js <PIN> [count=9] [url=http://localhost:3000]
const { io } = require('socket.io-client');

const [pin, countArg, urlArg] = process.argv.slice(2);
const count = Number(countArg) || 9;
const url = urlArg || 'http://localhost:3000';
if (!/^\d{6}$/.test(pin || '')) {
  console.error('Usage: node scripts/bots.js <PIN> [count] [url]');
  process.exit(1);
}

const NAMES = ['Aiman', 'Bella', 'Chong', 'Devi', 'Ezra', 'Farah', 'Guna', 'Hana', 'Irfan', 'Jia'];

for (let i = 0; i < count; i++) {
  const socket = io(url, { transports: ['websocket'] });
  const name = (NAMES[i % NAMES.length] + (i >= NAMES.length ? i : '')) + ' bot';
  const wpm = 45 + Math.random() * 60;
  const errorRate = Math.random() * 0.08;
  let round = 0;
  let timer = null;

  socket.on('connect', () => {
    socket.emit('player:join', { pin, name }, (r) => {
      if (!r || r.error) { console.error(name + ': ' + ((r && r.error) || 'join failed')); socket.close(); return; }
      console.log(name + ' joined (' + Math.round(wpm) + ' wpm)');
      setTimeout(() => socket.emit('player:ready', { ready: true }), 500 + Math.random() * 2500);
    });
  });

  socket.on('state', (s) => {
    if (s.phase !== 'racing' || s.startAt === round) return;
    round = s.startAt;
    clearInterval(timer);
    const len = s.text.length;
    const startLocal = Date.now() + (s.startAt - s.serverNow);
    const cps = (wpm * 5) / 60;
    timer = setInterval(() => {
      const elapsed = (Date.now() - startLocal) / 1000;
      if (elapsed <= 0) return;
      const chars = Math.min(len, Math.floor(elapsed * cps));
      const keystrokes = Math.round(chars * (1 + errorRate));
      socket.emit('player:progress', { chars, keystrokes, errors: keystrokes - chars });
      if (chars >= len) clearInterval(timer);
    }, 150);
  });

  socket.on('kicked', () => { console.log(name + ' was removed'); clearInterval(timer); socket.close(); });
  socket.on('closed', () => { clearInterval(timer); socket.close(); });
}

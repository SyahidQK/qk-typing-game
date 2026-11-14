// Keeps a clock aligned to the server so the countdown fires at the same
// moment on every device, whatever each laptop's own clock says.
export function createClock(socket) {
  let offset = 0;
  let bestRtt = Infinity;

  function sample() {
    const t0 = Date.now();
    socket.emit('time:sync', (serverNow) => {
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (rtt < bestRtt) {
        bestRtt = rtt;
        offset = serverNow - (t0 + t1) / 2;
      }
    });
  }

  function sync() {
    bestRtt = Infinity;
    for (let i = 0; i < 5; i++) setTimeout(sample, i * 250);
  }

  socket.on('connect', sync);
  if (socket.connected) sync();
  setInterval(sample, 20000);

  return { now: () => Date.now() + offset };
}

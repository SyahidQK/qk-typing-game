// Glyph rain: columns of keyboard characters fall behind the main screens.
// Each drop has a bright head and a fading orange trail, the characters keep
// changing, and the columns near the cursor surge. It only runs on screens
// marked with data-rain, so the race itself stays calm.
import { motionOK } from './fx.js';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*+=<>?/;:!';
const CELL = 24;            // size of one glyph cell in CSS pixels
const DENSITY = 0.55;       // share of columns that carry a drop
const FPS = 30;
const TRAIL = [255, 106, 0];   // event orange
const HEAD = [255, 236, 190];  // warm white
const SURGE_RADIUS = 110;      // how close the cursor has to be, in pixels

const canvas = document.createElement('canvas');
canvas.className = 'rain';
canvas.setAttribute('aria-hidden', 'true');
document.body.prepend(canvas);
const ctx = canvas.getContext('2d');

let width = 0, height = 0, cols = 0, rows = 0;
let drops = [];
let glyphs = [];   // one character per cell, mutated over time
let pointerX = -9999;
let active = false;
let timer = 0;
let last = 0;

const pick = () => CHARSET[Math.floor(Math.random() * CHARSET.length)];

function newDrop(fromTop) {
  return {
    on: Math.random() < DENSITY,
    y: fromTop ? -Math.random() * rows * 0.8 : Math.random() * rows,
    speed: 5 + Math.random() * 11,          // rows per second
    len: 7 + Math.floor(Math.random() * 15),
    wait: Math.random() * 2.5                // pause before an idle column tries again
  };
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cols = Math.ceil(width / CELL);
  rows = Math.ceil(height / CELL) + 1;
  drops = Array.from({ length: cols }, () => newDrop(false));
  glyphs = Array.from({ length: cols * rows }, pick);
  if (!timer) draw(0);
}

function draw(dt) {
  ctx.clearRect(0, 0, width, height);
  ctx.font = '600 ' + Math.round(CELL * 0.66) + 'px "JetBrains Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // a handful of cells change character every frame
  for (let i = 0; i < cols * 0.6; i++) glyphs[Math.floor(Math.random() * glyphs.length)] = pick();

  for (let c = 0; c < cols; c++) {
    const d = drops[c];
    const x = c * CELL + CELL / 2;
    const near = Math.max(0, 1 - Math.abs(x - pointerX) / SURGE_RADIUS); // 0..1
    if (!d.on) {
      d.wait -= dt;
      if (d.wait <= 0 || near > 0.6) { drops[c] = newDrop(true); drops[c].on = true; }
      continue;
    }
    d.y += d.speed * (1 + near * 2.2) * dt;
    const head = Math.floor(d.y);
    if (head - d.len > rows) { drops[c] = newDrop(true); continue; }

    for (let i = 0; i <= d.len; i++) {
      const r = head - i;
      if (r < 0 || r >= rows) continue;
      const ch = glyphs[r * cols + c];
      const y = r * CELL + CELL / 2;
      if (i === 0) {
        ctx.shadowColor = 'rgba(255, 170, 60, .95)';
        ctx.shadowBlur = 14 + near * 14;
        ctx.fillStyle = 'rgba(' + HEAD + ',' + (0.9 + near * 0.1) + ')';
        ctx.fillText(ch, x, y);
        ctx.shadowBlur = 0;
      } else {
        const fade = Math.pow(1 - i / (d.len + 1), 1.7);
        ctx.fillStyle = 'rgba(' + TRAIL + ',' + (fade * (0.5 + near * 0.4)).toFixed(3) + ')';
        ctx.fillText(ch, x, y);
      }
    }
  }
}

function tick() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  draw(dt);
}

function setActive(on) {
  if (on === active) return;
  active = on;
  canvas.classList.toggle('is-on', on);
  clearInterval(timer);
  timer = 0;
  if (on && motionOK() && !document.hidden) {
    last = performance.now();
    timer = setInterval(tick, 1000 / FPS);
  }
}

// run only while a screen that asks for rain is showing
function sync() {
  const shown = document.querySelector('.screen:not([hidden])');
  setActive(!!shown && shown.hasAttribute('data-rain'));
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', (e) => { pointerX = e.clientX; }, { passive: true });
window.addEventListener('pointerleave', () => { pointerX = -9999; });
document.addEventListener('visibilitychange', () => { setActive(false); sync(); }); // pause in a background tab
new MutationObserver(sync).observe(document.querySelector('main'), { subtree: true, attributes: true, attributeFilter: ['hidden'] });

resize();
sync();

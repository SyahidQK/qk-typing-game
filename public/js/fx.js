// Small motion effects. All of them are skipped when the device asks for
// reduced motion (add ?motion=1 to the address to force them on for testing).
const forced = /[?&]motion=1/.test(location.search);
export const motionOK = () => forced || !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let layer = null;
function fxLayer() {
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
  }
  return layer;
}

// A few sparks flying up from a point on screen (viewport coordinates).
export function sparks(x, y, colors, count = 3) {
  if (!motionOK()) return;
  const host = fxLayer();
  if (host.childElementCount > 60) return;
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('i');
    const size = 4 + Math.random() * 4;
    dot.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + size + 'px;height:' + size +
      'px;background:' + colors[Math.floor(Math.random() * colors.length)];
    host.appendChild(dot);
    const dx = (Math.random() - 0.35) * 46;
    const dy = -(14 + Math.random() * 30);
    dot.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.2)', opacity: 0 }
      ],
      { duration: 380 + Math.random() * 220, easing: 'cubic-bezier(.2,.7,.3,1)' }
    ).onfinish = () => dot.remove();
  }
}

// The letter that was just typed pops like a pressed key springing back.
export function popLetter(el) {
  if (!el || !motionOK()) return;
  el.animate(
    [
      { transform: 'translateY(-7px) scale(1.55)' },
      { transform: 'translateY(0) scale(1)' }
    ],
    { duration: 200, easing: 'cubic-bezier(.2,1.5,.4,1)' }
  );
}

export function shake(el) {
  if (!el || !motionOK()) return;
  el.animate(
    [{ transform: 'translateX(0)' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' },
      { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }],
    { duration: 220 }
  );
}

// Looping hop used for a running racer. Speed is set through playbackRate.
export function runLoop(el) {
  return el.animate(
    [
      { transform: 'translateY(0) rotate(4deg) scale(1.06, .92)' },
      { transform: 'translateY(-34%) rotate(12deg) scale(.96, 1.06)', offset: 0.5 },
      { transform: 'translateY(0) rotate(4deg) scale(1.06, .92)' }
    ],
    { duration: 440, iterations: Infinity, easing: 'ease-in-out' }
  );
}

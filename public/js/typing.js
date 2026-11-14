// Word-by-word typing engine. A word is accepted only when it matches
// exactly (including its trailing space), so mistakes must be corrected
// before the racer can move on.
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const OVERSHOOT = 6; // wrong characters allowed past the end of a word

export function createTyping({ text, textEl, inputEl, onProgress, onFinish, onError, onWord, onKey }) {
  let popLast = false; // mark the letter that was just typed so it can be animated
  const words = text.split(' ');
  let wi = 0;        // index of the word being typed
  let done = 0;      // characters locked in by completed words
  let prev = '';     // previous input value
  let keystrokes = 0;
  let errors = 0;
  let finished = false;

  const target = () => (wi < words.length ? words[wi] + (wi < words.length - 1 ? ' ' : '') : '');
  const prefixLen = (v, t) => {
    let i = 0;
    while (i < v.length && i < t.length && v[i] === t[i]) i++;
    return i;
  };
  const stats = () => ({
    chars: finished ? text.length : done + prefixLen(inputEl.value, target()),
    keystrokes,
    errors
  });

  function render() {
    const v = finished ? '' : inputEl.value;
    const ok = prefixLen(v, target());
    const a = done;
    const b = done + ok;
    const c = Math.min(text.length, done + v.length);
    const wordEnd = Math.max(c, wi < words.length ? done + words[wi].length : text.length);
    textEl.innerHTML =
      '<span class="t-done">' + esc(text.slice(0, a)) + '</span>' +
      '<span class="t-ok">' + (popLast && b > a
        ? esc(text.slice(a, b - 1)) + '<span class="t-pop">' + esc(text[b - 1]) + '</span>'
        : esc(text.slice(a, b))) + '</span>' +
      '<span class="t-bad">' + esc(text.slice(b, c)) + '</span>' +
      '<span class="t-caret"></span>' +
      '<span class="t-cur">' + esc(text.slice(c, wordEnd)) + '</span>' +
      '<span class="t-rest">' + esc(text.slice(wordEnd)) + '</span>';
    inputEl.classList.toggle('is-bad', c > b);
    const caret = textEl.querySelector('.t-caret');
    const top = caret.offsetTop - textEl.offsetTop;
    if (top < textEl.scrollTop || top > textEl.scrollTop + textEl.clientHeight - 64) {
      textEl.scrollTop = Math.max(0, top - 40);
    }
  }

  function handleInput() {
    if (finished) return;
    let v = inputEl.value;
    const added = Math.max(0, v.length - prev.length);
    keystrokes += added;
    // Accept every completed word. Usually one per keystroke, but several
    // characters can arrive in a single input event on some devices.
    let advanced = false;
    while (!finished && v.startsWith(target())) {
      const t = target();
      v = v.slice(t.length);
      done += t.length;
      wi++;
      advanced = true;
      if (wi >= words.length) { finished = true; v = ''; }
    }
    const t = target();
    if (v.length > t.length + OVERSHOOT) v = v.slice(0, t.length + OVERSHOOT);
    const wrong = prefixLen(v, t) < v.length;
    if (added && wrong) {
      errors += Math.min(added, v.length - prefixLen(v, t));
      if (onError) onError();
    }
    popLast = added > 0 && !wrong;
    if (v !== inputEl.value) inputEl.value = v;
    prev = v;
    if (advanced && !finished && onWord) onWord();
    render();
    if (added && onKey) onKey({ correct: !wrong, wordDone: advanced });
    popLast = false;
    if (onProgress) onProgress(stats());
    if (finished && onFinish) onFinish(stats());
  }

  const block = (e) => e.preventDefault();
  const blockPaste = (e) => {
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') e.preventDefault();
  };
  inputEl.addEventListener('input', handleInput);
  inputEl.addEventListener('paste', block);
  inputEl.addEventListener('drop', block);
  inputEl.addEventListener('beforeinput', blockPaste);

  inputEl.value = '';
  render();

  return {
    stats,
    get finished() { return finished; },
    // Resume after a refresh: continue from the last completed word.
    restore(chars, alreadyFinished) {
      wi = 0; done = 0; prev = ''; inputEl.value = '';
      if (alreadyFinished) { finished = true; wi = words.length; done = text.length; }
      else {
        while (wi < words.length - 1 && done + words[wi].length + 1 <= chars) {
          done += words[wi].length + 1;
          wi++;
        }
      }
      keystrokes = done;
      render();
    },
    destroy() {
      inputEl.removeEventListener('input', handleInput);
      inputEl.removeEventListener('paste', block);
      inputEl.removeEventListener('drop', block);
      inputEl.removeEventListener('beforeinput', blockPaste);
    }
  };
}

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, normalizeText, positionPoints } = require('../server/game');

function setup(n = 3, texts = ['hello world foo', 'second round text', 'third round text']) {
  let t = 1_000_000;
  const clock = { now: () => t, add: (ms) => { t += ms; } };
  const g = new Game({ texts, now: clock.now, countdownMs: 4000, roundCapMs: 60000 });
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(g.addPlayer('P' + i).player);
  return { g, ps, clock };
}

test('normalizeText straightens quotes and collapses whitespace', () => {
  assert.equal(normalizeText('  “Hi”  it’s \n me — ok… '), '"Hi" it\'s me - ok...');
});

test('join rules: unique names, lobby only, max players', () => {
  const { g } = setup(0);
  assert.ok(g.addPlayer('Ali').ok);
  assert.ok(g.addPlayer(' ali ').error);
  assert.ok(g.addPlayer('   ').error);
  for (let i = 0; i < 9; i++) assert.ok(g.addPlayer('N' + i).ok);
  assert.match(g.addPlayer('Extra').error, /full/);
  const looks = new Set([...g.players.values()].map((p) => p.avatar));
  assert.equal(looks.size, 10);
});

test('racers can pick one of 15 animals; a taken one is refused', () => {
  const { g } = setup(0);
  assert.equal(g.avatarOptions().length, 15);
  const a = g.addPlayer('Ali', 12);
  assert.ok(a.ok);
  assert.equal(a.player.avatar, g.avatarOptions()[12].emoji);
  assert.equal(g.avatarOptions()[12].taken, true);
  assert.match(g.addPlayer('Bo', 12).error, /taken/);
  assert.ok(g.addPlayer('Bo', 99).error);
  assert.ok(g.addPlayer('Bo', 'x').error);
  assert.equal(g.addPlayer('Bo').player.look, 0); // no choice: first free animal
});

test('start needs everyone ready unless forced', () => {
  const { g, ps } = setup(2);
  assert.ok(g.startRound().error);
  g.setReady(ps[0].id, true);
  assert.ok(g.startRound().error);
  g.setReady(ps[1].id, true);
  assert.ok(g.startRound().ok);
  assert.equal(g.phase, 'racing');
  assert.ok(g.addPlayer('Late').error);
  const g2 = setup(2).g;
  assert.ok(g2.startRound({ force: true }).ok);
});

test('progress is ignored before the start and when impossibly fast', () => {
  const { g, ps, clock } = setup(1);
  g.startRound({ force: true });
  assert.ok(g.updateProgress(ps[0].id, 3, 3, 0).ignored);
  clock.add(4000 + 100);
  assert.ok(g.updateProgress(ps[0].id, 15, 15, 0).tooFast);
  assert.equal(g.players.get(ps[0].id).progress, 0);
  clock.add(2000);
  assert.ok(g.updateProgress(ps[0].id, 15, 15, 0).finished);
});

test('scoring: places, accuracy bonus, unfinished players ranked by progress', () => {
  const { g, ps, clock } = setup(3);
  g.startRound({ force: true });
  clock.add(4000 + 6000);
  const len = g.text.length; // 15
  const r = g.updateProgress(ps[1].id, len, 20, 2); // 90% accuracy
  assert.equal(r.finished, true);
  assert.equal(r.allDone, false);
  clock.add(2000);
  g.updateProgress(ps[0].id, 7, 7, 0);
  g.updateProgress(ps[2].id, 9, 9, 0);
  g.endRound();
  assert.equal(g.phase, 'results');
  const [a, b, c] = ps.map((p) => g.players.get(p.id));
  assert.equal(b.place, 1);
  assert.equal(b.roundPoints, 1000 + 90);
  assert.equal(b.wpm, Math.round((15 / 5) / (6000 / 60000)));
  assert.equal(c.place, 2);
  assert.equal(c.roundPoints, positionPoints(2));
  assert.equal(a.place, 3);
  assert.equal(a.roundPoints, positionPoints(3));
  assert.deepEqual([b.rank, c.rank, a.rank], [1, 2, 3]);
});

test('three rounds lead to final; ranks track totals', () => {
  const { g, ps, clock } = setup(2);
  const order = [[0, 1], [1, 0], [1, 0]];
  for (let r = 0; r < 3; r++) {
    assert.ok(g.startRound({ force: true }).ok);
    clock.add(4000 + 5000);
    for (const i of order[r]) {
      clock.add(1000);
      g.updateProgress(ps[i].id, g.text.length, g.text.length, 0);
    }
    assert.equal(g.allDone(), true);
    g.endRound();
  }
  assert.equal(g.phase, 'final');
  assert.ok(g.startRound({ force: true }).error);
  const p0 = g.players.get(ps[0].id), p1 = g.players.get(ps[1].id);
  assert.equal(p1.total, 1000 + 1100 + 1100);
  assert.equal(p0.total, 1100 + 1000 + 1000);
  assert.equal(p1.rank, 1);
  const s = g.publicState();
  assert.equal(s.players.length, 2);
  assert.equal(s.players[0].token, undefined);
});

test('allDone ignores disconnected players; zero progress scores zero', () => {
  const { g, ps, clock } = setup(2);
  g.startRound({ force: true });
  clock.add(4000 + 5000);
  g.players.get(ps[1].id).connected = false;
  const r = g.updateProgress(ps[0].id, g.text.length, 15, 0);
  assert.equal(r.allDone, true);
  g.endRound();
  assert.equal(g.players.get(ps[1].id).roundPoints, 0);
});

test('replaying a round removes its points and races the same text again', () => {
  const { g, ps, clock } = setup(2);
  const finish = (order) => {
    clock.add(4000 + 5000);
    for (const i of order) { clock.add(1000); g.updateProgress(ps[i].id, g.text.length, g.text.length, 0); }
    g.endRound();
  };
  assert.ok(g.redoRound().error);
  g.startRound({ force: true });
  finish([0, 1]);
  const p0 = g.players.get(ps[0].id), p1 = g.players.get(ps[1].id);
  assert.deepEqual([p0.total, p1.total], [1100, 1000]);

  // replay round 1: totals back to zero, same text, fresh progress
  const text1 = g.text;
  assert.ok(g.redoRound().ok);
  assert.equal(g.phase, 'racing');
  assert.equal(g.round, 1);
  assert.equal(g.text, text1);
  assert.deepEqual([p0.total, p1.total, p0.totalTimeMs], [0, 0, 0]);
  assert.deepEqual([p0.progress, p0.finished], [0, false]);
  finish([1, 0]);
  assert.deepEqual([p0.total, p1.total], [1000, 1100]);
  assert.equal(p1.rank, 1);

  // replay the last round from the final screen
  g.startRound({ force: true }); finish([0, 1]);
  g.startRound({ force: true }); finish([0, 1]);
  assert.equal(g.phase, 'final');
  const before = [p0.undo.total, p1.undo.total];
  assert.ok(g.redoRound().ok);
  assert.equal(g.round, 3);
  assert.deepEqual([p0.total, p1.total], before);
  finish([1, 0]);
  assert.equal(g.phase, 'final');
  // round 1 replay (1st), round 2 (2nd), round 3 replay (1st): the discarded runs never count
  assert.equal(p1.total, 1100 + 1000 + 1100);
});

test('texts can only be edited in the lobby', () => {
  const { g } = setup(1);
  assert.ok(g.setTexts(['short']).error);
  assert.ok(g.setTexts(['a long enough text', 'another long text']).ok);
  assert.equal(g.rounds, 2);
  g.startRound({ force: true });
  assert.ok(g.setTexts(['a long enough text']).error);
});

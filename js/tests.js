/**
 * tests.js — unit tests for game.js. Open tests.html in a browser, or run:
 *   node --input-type=module -e "import('./js/tests.js').then(m => m.printResults())"
 */
import {
  parseCards, detectCombo, beats, isChop, COMBO, newGame, validatePlay, applyPlay, applyPass,
  passError, detectInstantWin, scoreDeltas, viewFor, autoMove, deal, shuffle, DEFAULT_SETTINGS, THREE_SPADES,
} from './game.js';

const tests = [];
const test = (group, name, fn) => tests.push({ group, name, fn });

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? `${msg}: ` : ''}expected ${e}, got ${a}`);
}
function ok(value, msg = 'expected true') { if (!value) throw new Error(msg); }
function no(value, msg = 'expected false') { if (value) throw new Error(msg); }
function throwsWith(fn, text) {
  try { fn(); } catch (err) {
    if (text && !err.message.includes(text)) throw new Error(`threw "${err.message}", expected "${text}"`);
    return;
  }
  throw new Error('expected an error');
}

const C = parseCards;
const combo = (text) => detectCombo(C(text));
const typeOf = (text) => (combo(text) ? combo(text).type : null);
const beat = (a, b) => beats(combo(a), combo(b));
const settings = (patch = {}) => ({ ...DEFAULT_SETTINGS, instantWin: false, ...patch });

/* ── Combination detection ── */

test('Combos', 'single, pair, triple, four of a kind', () => {
  eq(typeOf('7♥'), COMBO.SINGLE);
  eq(typeOf('9♠ 9♥'), COMBO.PAIR);
  eq(typeOf('K♠ K♦ K♥'), COMBO.TRIPLE);
  eq(typeOf('5♠ 5♣ 5♦ 5♥'), COMBO.FOUR);
});
test('Combos', 'mismatched ranks are not a pair/triple', () => {
  eq(typeOf('9♠ 10♥'), null);
  eq(typeOf('9♠ 9♥ 10♥'), null);
});
test('Combos', 'straights of 3+ consecutive ranks, any suits', () => {
  eq(typeOf('3♠ 4♥ 5♦'), COMBO.STRAIGHT);
  eq(typeOf('8♣ 9♦ 10♠ J♥ Q♣ K♦'), COMBO.STRAIGHT);
  eq(typeOf('3♠ 4♣ 5♦ 6♥ 7♠ 8♣ 9♦ 10♥ J♠ Q♣ K♦ A♥'), COMBO.STRAIGHT);
});
test('Combos', 'Q-K-A is a straight; K-A-2 and A-2-3 are not', () => {
  eq(typeOf('Q♠ K♥ A♦'), COMBO.STRAIGHT);
  eq(typeOf('K♠ A♥ 2♦'), null);
  eq(typeOf('A♠ 2♥ 3♦'), null);
  eq(typeOf('J♠ Q♥ K♦ A♣ 2♠'), null);
});
test('Combos', 'gaps or repeated ranks break a straight', () => {
  eq(typeOf('3♠ 4♥ 6♦'), null);
  eq(typeOf('5♠ 5♥ 6♦ 7♣'), null);
  eq(typeOf('3♠ 4♥'), null, 'two cards is not a straight');
});
test('Combos', 'consecutive pairs (đôi thông)', () => {
  const c3 = combo('3♠ 3♥ 4♣ 4♦ 5♠ 5♥');
  eq([c3.type, c3.pairs], [COMBO.PAIRS, 3]);
  const c4 = combo('9♠ 9♥ 10♣ 10♦ J♠ J♥ Q♣ Q♦');
  eq([c4.type, c4.pairs], [COMBO.PAIRS, 4]);
  eq(typeOf('Q♠ Q♥ K♣ K♦ A♠ A♥'), COMBO.PAIRS, 'QQ-KK-AA is fine');
});
test('Combos', 'consecutive pairs cannot include 2s or gaps', () => {
  eq(typeOf('K♠ K♥ A♣ A♦ 2♠ 2♥'), null);
  eq(typeOf('3♠ 3♥ 4♣ 4♦ 6♠ 6♥'), null);
  eq(typeOf('3♠ 3♥ 4♣ 4♦'), null, 'only two pairs');
  eq(typeOf('3♠ 3♥ 3♣ 4♦ 5♠ 5♥'), null, 'a triple plus a single is not two pairs');
});
test('Combos', 'empty or duplicate cards are invalid', () => {
  eq(detectCombo([]), null);
  eq(detectCombo([5, 5]), null);
});
test('Combos', 'top card is the highest by rank then suit', () => {
  eq(combo('7♦ 7♠').top, C('7♦')[0]);
  eq(combo('5♥ 6♠ 7♣').top, C('7♣')[0]);
});

/* ── Normal comparison ── */

test('Compare', 'singles: rank first, then suit', () => {
  ok(beat('6♠', '5♥'), '6♠ > 5♥');
  ok(beat('5♥', '5♦'), '5♥ > 5♦');
  no(beat('5♦', '5♥'), '5♦ < 5♥');
  ok(beat('2♠', 'A♥'), '2 is the highest rank');
  ok(beat('2♥', '2♦'));
});
test('Compare', 'pairs compare by their highest card', () => {
  ok(beat('7♠ 7♥', '7♣ 7♦'), '7♥ beats 7♦');
  no(beat('7♣ 7♦', '7♠ 7♥'));
  ok(beat('8♠ 8♣', '7♦ 7♥'));
});
test('Compare', 'straights: same length, higher top card', () => {
  ok(beat('5♠ 6♠ 7♥', '5♣ 6♥ 7♦'), 'ending 7♥ beats ending 7♦');
  ok(beat('6♠ 7♠ 8♠', '5♣ 6♥ 7♥'));
  no(beat('6♠ 7♠ 8♠ 9♠', '5♣ 6♥ 7♥'), 'different length');
  no(beat('6♠ 7♠ 8♠', '5♣ 6♥ 7♥ 8♥'), 'different length');
});
test('Compare', 'different types cannot beat each other', () => {
  no(beat('9♠ 9♥', '3♠'));
  no(beat('9♠ 10♥ J♦', '8♠ 8♥ 8♦'));
  no(beat('9♠ 9♥ 9♦', '3♠ 3♥'));
});

/* ── Chopping (chặt) ── */

const THREE_PAIRS = '3♠ 3♥ 4♣ 4♦ 5♠ 5♥';
const THREE_PAIRS_HIGH = '6♠ 6♥ 7♣ 7♦ 8♠ 8♥';
const FOUR_PAIRS = '9♠ 9♥ 10♣ 10♦ J♠ J♥ Q♣ Q♦';
const FOUR_PAIRS_HIGH = '10♠ 10♥ J♣ J♦ Q♠ Q♥ K♣ K♦';
const FOUR_SIXES = '6♠ 6♣ 6♦ 6♥';
const FOUR_KINGS = 'K♠ K♣ K♦ K♥';

test('Chop', 'single 2 ← 3 consecutive pairs', () => ok(beat(THREE_PAIRS, '2♥')));
test('Chop', 'single 2 ← four of a kind', () => ok(beat(FOUR_SIXES, '2♥')));
test('Chop', 'single 2 ← 4 consecutive pairs', () => ok(beat(FOUR_PAIRS, '2♥')));
test('Chop', 'single 2 is NOT beaten by a pair/triple/straight', () => {
  no(beat('3♠ 3♥', '2♠'));
  no(beat('3♠ 3♥ 3♦', '2♠'));
  no(beat('3♠ 4♥ 5♦', '2♠'));
});
test('Chop', 'bombs only chop 2s — not other singles', () => {
  no(beat(THREE_PAIRS, 'A♥'));
  no(beat(FOUR_SIXES, 'A♥'));
});
test('Chop', 'pair of 2s ← four of a kind', () => ok(beat(FOUR_SIXES, '2♠ 2♣')));
test('Chop', 'pair of 2s ← 4 consecutive pairs', () => ok(beat(FOUR_PAIRS, '2♠ 2♣')));
test('Chop', 'pair of 2s is NOT beaten by 3 consecutive pairs', () => no(beat(THREE_PAIRS_HIGH, '2♠ 2♣')));
test('Chop', '3 consecutive pairs ← higher 3 consecutive pairs', () => {
  ok(beat(THREE_PAIRS_HIGH, THREE_PAIRS));
  no(beat(THREE_PAIRS, THREE_PAIRS_HIGH));
});
test('Chop', '3 consecutive pairs ← four of a kind', () => ok(beat(FOUR_SIXES, THREE_PAIRS_HIGH)));
test('Chop', '3 consecutive pairs ← 4 consecutive pairs', () => ok(beat(FOUR_PAIRS, THREE_PAIRS_HIGH)));
test('Chop', 'four of a kind ← higher four of a kind', () => {
  ok(beat(FOUR_KINGS, FOUR_SIXES));
  no(beat(FOUR_SIXES, FOUR_KINGS));
});
test('Chop', 'four of a kind ← 4 consecutive pairs', () => ok(beat(FOUR_PAIRS, FOUR_KINGS)));
test('Chop', 'four of a kind is NOT beaten by 3 consecutive pairs', () => no(beat(THREE_PAIRS_HIGH, FOUR_SIXES)));
test('Chop', '4 consecutive pairs ← higher 4 consecutive pairs only', () => {
  ok(beat(FOUR_PAIRS_HIGH, FOUR_PAIRS));
  no(beat(FOUR_PAIRS, FOUR_PAIRS_HIGH));
  no(beat(FOUR_KINGS, FOUR_PAIRS), 'four of a kind cannot beat 4 consecutive pairs');
  no(beat(THREE_PAIRS_HIGH, FOUR_PAIRS));
});
test('Chop', 'isChop flags chops but not normal plays', () => {
  ok(isChop(combo(THREE_PAIRS), combo('2♥')));
  ok(isChop(combo(FOUR_PAIRS), combo(FOUR_KINGS)));
  no(isChop(combo('2♥'), combo('2♦')), 'a higher 2 is a normal play');
  no(isChop(combo('9♠ 9♥'), combo('8♠ 8♥')));
});

/* ── Game flow ── */

// Hands are 13 cards in real games; short hands keep these tests readable.
function game(hands, opts = {}) {
  return newGame(hands.map(C), { settings: settings(opts.settings), leader: opts.leader ?? null });
}

test('Opening', 'first game: the 3♠ holder leads and must include 3♠', () => {
  const g = game(['4♠ 9♥', '3♠ 3♥ 5♦', '6♠ 7♠', '8♠ 10♠']);
  eq(g.turn, 1);
  ok(g.requireThreeSpades);
  const bad = validatePlay(g, 1, C('5♦'));
  no(bad.ok);
  eq(bad.reason, 'First play must include 3♠');
  ok(validatePlay(g, 1, C('3♠')).ok);
  ok(validatePlay(g, 1, C('3♠ 3♥')).ok, 'a pair containing 3♠ is fine');
  no(validatePlay(g, 1, C('3♥')).ok);
});
test('Opening', '3♠ rule ends after the first play', () => {
  let g = game(['4♠ 9♥', '3♠ 3♥ 5♦', '6♠ 7♠', '8♠ 10♠']);
  g = applyPlay(g, 1, C('3♠'));
  no(g.requireThreeSpades);
  eq(g.turn, 2);
});
test('Opening', 'later games: previous winner leads with anything', () => {
  const g = game(['4♠ 9♥', '3♠ 3♥ 5♦', '6♠ 7♠', '8♠ 10♠'], { leader: 3 });
  eq(g.turn, 3);
  no(g.requireThreeSpades);
  ok(validatePlay(g, 3, C('10♠')).ok);
});
test('Opening', 'cannot pass when leading', () => {
  const g = game(['4♠ 9♥', '3♠ 3♥ 5♦', '6♠ 7♠', '8♠ 10♠']);
  ok(passError(g, 1));
  throwsWith(() => applyPass(g, 1), 'must play');
});

test('Turns', 'must beat the current play', () => {
  let g = game(['3♠ 9♥', '4♠ 9♠', '5♠ 6♠', '7♠ 8♠']);
  g = applyPlay(g, 0, C('3♠'));
  eq(g.turn, 1);
  ok(validatePlay(g, 1, C('9♠')).ok);
  throwsWith(() => applyPlay(g, 2, C('5♠')), 'Not your turn');
});
test('Turns', 'counter-clockwise by default, clockwise when set', () => {
  eq(applyPlay(game(['3♠ 9♥', '4♠', '5♠', '7♠']), 0, C('3♠')).turn, 1);
  eq(applyPlay(game(['3♠ 9♥', '4♠', '5♠', '7♠'], { settings: { direction: 'cw' } }), 0, C('3♠')).turn, 3);
});
test('Turns', 'passed players are skipped; last player to play leads next round', () => {
  let g = game(['3♠ 4♠ 5♠', '6♠ 7♠', '8♠ 9♠', '10♠ J♠']);
  g = applyPlay(g, 0, C('3♠'));
  g = applyPass(g, 1);
  g = applyPlay(g, 2, C('8♠'));
  g = applyPass(g, 3);
  eq(g.turn, 0, 'seat 1 passed and is skipped');
  throwsWith(() => applyPlay(g, 1, C('7♠')), 'passed');
  g = applyPass(g, 0);
  eq(g.current, null, 'round over');
  eq(g.turn, 2, 'seat 2 played last and leads');
  eq(g.passed, [false, false, false, false]);
});
test('Turns', 'passed players can chop only when the setting is on', () => {
  const hands = ['3♠ 2♥ 9♥', '4♠ 4♥ 5♣ 5♦ 6♠ 6♥ K♥', '8♠ 9♠', '10♠ J♠'];
  let off = game(hands);
  off = applyPlay(off, 0, C('3♠'));
  off = applyPass(off, 1);
  off = applyPlay(off, 2, C('8♠'));
  off = applyPlay(off, 3, C('10♠'));
  off = applyPlay(off, 0, C('2♥'));
  no(validatePlay(off, 1, C('4♠ 4♥ 5♣ 5♦ 6♠ 6♥')).ok, 'locked out by default');

  let on = game(hands, { settings: { chopAfterPass: true } });
  on = applyPlay(on, 0, C('3♠'));
  on = applyPass(on, 1);
  on = applyPlay(on, 2, C('8♠'));
  on = applyPlay(on, 3, C('10♠'));
  on = applyPlay(on, 0, C('2♥'));
  const check = validatePlay(on, 1, C('4♠ 4♥ 5♣ 5♦ 6♠ 6♥'));
  ok(check.ok && check.outOfTurn && check.chop, 'out-of-turn chop allowed');
  no(validatePlay(on, 1, C('K♥')).ok, 'but only a chop');
  on = applyPlay(on, 1, C('4♠ 4♥ 5♣ 5♦ 6♠ 6♥'));
  const last = on.log[on.log.length - 1];
  ok(last.chop && last.victim === 0, 'logged as a chop of seat 0');
  eq(on.turn, 2, 'play continues after the chopper');
});

/* ── Finishing order ── */

test('Finish', 'players finish in order; the last one is 4th automatically', () => {
  let g = game(['3♠', '4♠ J♠', '5♠ Q♠', '6♠ 7♠ 8♠']);
  g = applyPlay(g, 0, C('3♠'));
  eq(g.finished, [0]);
  g = applyPlay(g, 1, C('4♠'));
  g = applyPlay(g, 2, C('5♠'));
  g = applyPlay(g, 3, C('6♠'));
  eq(g.turn, 1, 'finished seat 0 is skipped');
  g = applyPlay(g, 1, C('J♠'));
  eq(g.finished, [0, 1]);
  no(g.over);
  eq(g.turn, 2);
  g = applyPlay(g, 2, C('Q♠'));
  ok(g.over, 'game over when one player is left');
  eq(g.finished, [0, 1, 2, 3]);
  eq(g.turn, null);
});
test('Finish', 'if the round winner has finished, the next player in play leads', () => {
  let g = game(['3♠', '4♠ 5♠', '6♠ 7♠', '8♠ 9♠']);
  g = applyPlay(g, 0, C('3♠'));
  g = applyPass(g, 1);
  g = applyPass(g, 2);
  g = applyPass(g, 3);
  eq(g.current, null);
  eq(g.turn, 1);
});
test('Finish', 'scores: default +3 / +1 / -1 / -3 by place', () => {
  eq(scoreDeltas([2, 0, 3, 1], [3, 1, -1, -3]), [1, -3, 3, -1]);
});

/* ── Instant win (tới trắng) ── */

test('Instant win', 'detects four 2s, dragon, 5 consecutive pairs, 6 pairs', () => {
  eq(detectInstantWin(C('2♠ 2♣ 2♦ 2♥ 3♠ 5♦ 7♣ 9♥ J♠ K♦ A♣ 4♥ 6♠')).code, 'four2s');
  eq(detectInstantWin(C('3♠ 4♣ 5♦ 6♥ 7♠ 8♣ 9♦ 10♥ J♠ Q♣ K♦ A♥ 2♠')).code, 'dragon');
  eq(detectInstantWin(C('5♠ 5♥ 6♣ 6♦ 7♠ 7♥ 8♣ 8♦ 9♠ 9♥ J♠ K♦ 2♣')).code, 'fivePairs');
  eq(detectInstantWin(C('3♠ 3♥ 5♣ 5♦ 7♠ 7♥ 9♣ 9♦ J♠ J♥ K♣ K♦ 2♣')).code, 'sixPairs');
  eq(detectInstantWin(C('3♠ 3♥ 3♣ 3♦ 7♠ 7♥ 9♣ 9♦ J♠ J♥ K♣ K♦ 2♣')).code, 'sixPairs', 'four of a kind = 2 pairs');
  eq(detectInstantWin(C('3♠ 3♥ 5♣ 5♦ 7♠ 7♥ 9♣ 9♦ J♠ J♥ K♣ Q♦ 2♣')), null, 'only 5 pairs');
});
test('Instant win', 'ends the game at the deal with that player 1st', () => {
  const hands = [
    '3♠ 4♠ 5♠ 6♠ 7♠ 8♠ 9♠ 10♠ J♠ Q♠ K♠ A♠ 3♣',
    '2♠ 2♣ 2♦ 2♥ 4♣ 5♣ 6♣ 7♣ 8♣ 9♣ 10♣ J♣ Q♣',
    'K♣ A♣ 3♦ 4♦ 5♦ 6♦ 7♦ 8♦ 9♦ 10♦ J♦ Q♦ K♦',
    'A♦ 3♥ 4♥ 5♥ 6♥ 7♥ 8♥ 9♥ 10♥ J♥ Q♥ K♥ A♥',
  ];
  const g = newGame(hands.map(C), { settings: { ...DEFAULT_SETTINGS, instantWin: true } });
  ok(g.over);
  eq(g.instantWin.seat, 1, 'four 2s beats the dragon held by seat 0');
  eq(g.finished, [1, 2, 3, 0]);
  const off = newGame(hands.map(C), { settings: { ...DEFAULT_SETTINGS, instantWin: false } });
  no(off.over, 'can be switched off');
});

/* ── Misc ── */

test('Misc', 'deal: 4 hands of 13, all 52 cards, includes 3♠', () => {
  const hands = deal(4);
  eq(hands.map((h) => h.length), [13, 13, 13, 13]);
  eq(new Set(hands.flat()).size, 52);
  ok(hands.flat().includes(THREE_SPADES));
});
test('Misc', 'shuffle keeps every card', () => {
  const s = shuffle(Array.from({ length: 52 }, (_, i) => i));
  eq([...s].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i));
});
test('Misc', 'viewFor hides other players\' hands and card counts', () => {
  const g = game(['3♠ 9♥', '4♠ 9♠', '5♠ 6♠', '7♠ 8♠']);
  const v = viewFor(g, 2);
  eq(v.hands, [null, null, C('5♠ 6♠'), null]);
  eq(v.counts, [null, null, 2, null]);
});
test('Misc', 'viewFor log does not reveal played cards', () => {
  let g = game(['3♠ 9♥', '4♠ 9♠', '5♠ 6♠', '7♠ 8♠']);
  g = applyPlay(g, 0, C('3♠'));
  const v = viewFor(g, 1);
  const play = v.log.find((e) => e.type === 'play');
  ok(play && play.seat === 0, 'play event kept');
  no('cards' in play, 'but without its cards');
  eq(v.current.combo.cards, C('3♠'), 'the play on the table is still visible');
});
test('Misc', 'timeout: auto-pass when possible, otherwise lowest single', () => {
  let g = game(['3♠ 9♥', '4♠ 9♠', '5♠ 6♠', '7♠ 8♠']);
  eq(autoMove(g), { type: 'play', cards: C('3♠') });
  g = applyPlay(g, 0, C('3♠'));
  eq(autoMove(g), { type: 'pass' });
});
test('Misc', 'state transitions do not mutate their input', () => {
  const g = game(['3♠ 9♥', '4♠ 9♠', '5♠ 6♠', '7♠ 8♠']);
  const before = JSON.stringify(g);
  applyPlay(g, 0, C('3♠'));
  eq(JSON.stringify(g), before);
});

export function runTests() {
  return tests.map(({ group, name, fn }) => {
    try {
      fn();
      return { group, name, pass: true };
    } catch (err) {
      return { group, name, pass: false, error: err.message };
    }
  });
}

/** Console runner (used from Node). */
export function printResults() {
  const results = runTests();
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.group}] ${r.name}${r.pass ? '' : `\n      ${r.error}`}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (typeof process !== 'undefined' && failed) process.exitCode = 1;
}

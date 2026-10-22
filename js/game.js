/**
 * game.js — Tiến Lên (Southern rules / Miền Nam) rules engine.
 *
 * Pure logic: no DOM, no networking. State transitions (newGame, applyPlay,
 * applyPass) return a NEW state object and never mutate their input, so the
 * whole file can be unit-tested in isolation (see tests.html).
 *
 * Cards are integers 0..51:   card = rank * 4 + suit
 *   rank 0..12 → 3 4 5 6 7 8 9 10 J Q K A 2
 *   suit 0..3  → ♠ ♣ ♦ ♥
 * so comparing two card numbers compares their strength directly:
 * 3♠ = 0 is the lowest card, 2♥ = 51 the highest.
 */

export const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
export const SUITS = ['♠', '♣', '♦', '♥'];
const RANK_PLURALS = ['3s', '4s', '5s', '6s', '7s', '8s', '9s', '10s', 'Jacks', 'Queens', 'Kings', 'Aces', '2s'];

export const RANK_2 = 12;
export const THREE_SPADES = 0;
export const PLACE_NAMES = ['1st (Nhất)', '2nd (Nhì)', '3rd (Ba)', '4th (Bét)'];

export const COMBO = Object.freeze({
  SINGLE: 'single',
  PAIR: 'pair',
  TRIPLE: 'triple',
  FOUR: 'four',          // tứ quý
  STRAIGHT: 'straight',  // sảnh
  PAIRS: 'pairs',        // đôi thông (consecutive pairs)
});

export const DEFAULT_SETTINGS = Object.freeze({
  turnSeconds: 30,        // 0 = no timer
  instantWin: true,       // tới trắng
  chopAfterPass: false,   // players who passed may still chop (chặt) out of turn
  direction: 'ccw',       // 'ccw' (counter-clockwise) or 'cw'
  points: [3, 1, -1, -3], // 1st, 2nd, 3rd, 4th
});

const clone = (obj) => (typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj)));

/* ───────────────────────── Cards ───────────────────────── */

export const rankOf = (card) => card >> 2;
export const suitOf = (card) => card & 3;
export const isRedCard = (card) => suitOf(card) >= 2;
export const makeCard = (rank, suit) => rank * 4 + suit;
export const cardLabel = (card) => RANKS[rankOf(card)] + SUITS[suitOf(card)];
export const cardsLabel = (cards) => sortByRank(cards).map(cardLabel).join(' ');

export const sortByRank = (cards) => [...cards].sort((a, b) => a - b);
export const sortBySuit = (cards) => [...cards].sort((a, b) => suitOf(a) - suitOf(b) || a - b);

const SUIT_ALIASES = { '♠': 0, S: 0, '♣': 1, C: 1, '♦': 2, D: 2, '♥': 3, H: 3 };

/** "10♥" / "10H" / "3s" → card number. Handy for tests. */
export function parseCard(text) {
  const t = String(text).replace(/︎|️/g, '').trim().toUpperCase();
  const suit = SUIT_ALIASES[t.slice(-1)];
  const rank = RANKS.indexOf(t.slice(0, -1));
  if (suit === undefined || rank < 0) throw new Error(`Bad card: "${text}"`);
  return makeCard(rank, suit);
}

/** "3♠ 4♣ 5♦" → [0, 5, 10] */
export const parseCards = (text) => text.trim().split(/[\s,]+/).filter(Boolean).map(parseCard);

export const createDeck = () => Array.from({ length: 52 }, (_, i) => i);

/** Unbiased random integer in [0, n) using crypto.getRandomValues. */
export function cryptoRandomInt(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

/** Fisher–Yates shuffle. `randInt(n)` must return an integer in [0, n). */
export function shuffle(cards, randInt = cryptoRandomInt) {
  const a = [...cards];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shuffle a fresh deck and deal 13 cards to each of `players` players. */
export function deal(players = 4, randInt = cryptoRandomInt) {
  const deck = shuffle(createDeck(), randInt);
  return Array.from({ length: players }, (_, i) => sortByRank(deck.slice(i * 13, i * 13 + 13)));
}

/* ───────────────────────── Combinations ───────────────────────── */

/**
 * Detect what combination `cards` forms.
 * Returns { type, cards (sorted), size, top (highest card), pairs? } or null.
 */
export function detectCombo(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const s = sortByRank(cards);
  if (new Set(s).size !== s.length) return null;
  const n = s.length;
  const ranks = s.map(rankOf);
  const make = (type, extra = {}) => ({ type, cards: s, size: n, top: s[n - 1], ...extra });

  if (n === 1) return make(COMBO.SINGLE);
  if (ranks.every((r) => r === ranks[0])) {
    return make([null, null, COMBO.PAIR, COMBO.TRIPLE, COMBO.FOUR][n]);
  }
  const hasTwo = ranks[n - 1] === RANK_2;

  // Straight: 3+ distinct consecutive ranks, never containing a 2.
  if (n >= 3 && !hasTwo && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) {
    return make(COMBO.STRAIGHT);
  }

  // Consecutive pairs: 3+ pairs of consecutive ranks, never containing a 2.
  if (n >= 6 && n % 2 === 0 && !hasTwo) {
    let ok = true;
    for (let i = 0; i < n; i += 2) {
      if (ranks[i] !== ranks[i + 1] || (i > 0 && ranks[i] !== ranks[i - 2] + 1)) ok = false;
    }
    if (ok) return make(COMBO.PAIRS, { pairs: n / 2 });
  }
  return null;
}

const pairsOf = (combo) => (combo.type === COMBO.PAIRS ? combo.pairs : 0);
const isTwos = (combo) =>
  (combo.type === COMBO.SINGLE || combo.type === COMBO.PAIR) && rankOf(combo.top) === RANK_2;

/** Bombs are the combinations that can chop: four of a kind and 3+ consecutive pairs. */
export const isBomb = (combo) => !!combo && (combo.type === COMBO.FOUR || pairsOf(combo) >= 3);

/** Does combination `a` beat combination `b` (the one currently on the table)? */
export function beats(a, b) {
  if (!a) return false;
  if (!b) return true;
  // Normal rule: same type, same number of cards, higher top card.
  if (a.type === b.type && a.size === b.size) return a.top > b.top;

  // Chopping (chặt).
  const aPairs = pairsOf(a);
  const bPairs = pairsOf(b);
  if (isTwos(b) && b.type === COMBO.SINGLE) return a.type === COMBO.FOUR || aPairs >= 3;
  if (isTwos(b) && b.type === COMBO.PAIR) return a.type === COMBO.FOUR || aPairs >= 4;
  if (bPairs === 3) return a.type === COMBO.FOUR || aPairs >= 4;
  if (b.type === COMBO.FOUR) return aPairs >= 4;
  if (bPairs >= 4) return aPairs > bPairs;
  return false;
}

/** A chop is a bomb beating a 2, a pair of 2s, or another bomb. */
export const isChop = (a, b) => !!b && isBomb(a) && (isTwos(b) || isBomb(b)) && beats(a, b);

export function describeCombo(combo, withTop = false) {
  if (!combo) return '';
  const top = rankOf(combo.top);
  const low = RANKS[rankOf(combo.cards[0])];
  const high = withTop ? ` (${cardLabel(combo.top)} high)` : '';
  switch (combo.type) {
    case COMBO.SINGLE: return `single ${cardLabel(combo.top)}`;
    case COMBO.PAIR: return `pair of ${RANK_PLURALS[top]}${high}`;
    case COMBO.TRIPLE: return `three ${RANK_PLURALS[top]} (Sám)`;
    case COMBO.FOUR: return `four of a kind ${RANK_PLURALS[top]} (Tứ quý)`;
    case COMBO.STRAIGHT: return `straight ${low}→${RANKS[top]} (Sảnh)${high}`;
    case COMBO.PAIRS: return `${combo.pairs} consecutive pairs ${low}→${RANKS[top]} (Đôi thông)${high}`;
    default: return combo.type;
  }
}

/* ───────────────────────── Instant win (tới trắng) ───────────────────────── */

// Listed strongest first: if two players qualify, the earlier entry wins.
export const INSTANT_WINS = Object.freeze([
  { code: 'four2s', label: 'All four 2s (Tứ quý 2)' },
  { code: 'dragon', label: 'Dragon straight 3→A (Sảnh rồng)' },
  { code: 'fivePairs', label: '5 consecutive pairs (5 đôi thông)' },
  { code: 'sixPairs', label: '6 pairs (6 đôi)' },
]);

/** Returns { code, label, priority } if the 13-card hand wins instantly, else null. */
export function detectInstantWin(hand) {
  const counts = Array(13).fill(0);
  for (const c of hand) counts[rankOf(c)]++;
  const found = (i) => ({ ...INSTANT_WINS[i], priority: i });

  if (counts[RANK_2] === 4) return found(0);
  if (counts.slice(0, RANK_2).every((k) => k > 0)) return found(1);
  let run = 0;
  for (let r = 0; r < RANK_2; r++) {
    run = counts[r] >= 2 ? run + 1 : 0;
    if (run >= 5) return found(2);
  }
  // A four of a kind counts as two pairs.
  if (counts.reduce((sum, k) => sum + Math.floor(k / 2), 0) >= 6) return found(3);
  return null;
}

/* ───────────────────────── Game state ───────────────────────── */

const step = (state) => (state.settings.direction === 'cw' ? -1 : 1);

/** The seat `steps` places after `seat` in turn order. */
export const seatAfter = (state, seat, steps = 1) =>
  (((seat + step(state) * steps) % state.n) + state.n) % state.n;

const isOut = (state, seat) => state.finished.includes(seat);

/** Seats still holding cards. */
export const seatsInPlay = (state) =>
  Array.from({ length: state.n }, (_, i) => i).filter((i) => !isOut(state, i));

function nextInPlay(state, seat) {
  for (let i = 1; i <= state.n; i++) {
    const p = seatAfter(state, seat, i);
    if (!isOut(state, p)) return p;
  }
  return null;
}

const MAX_LOG = 60;
const VIEW_LOG = 12; // recent events sent to players (only used for animations)

function pushEvent(state, event) {
  state.eventId += 1;
  const ev = { id: state.eventId, ...event };
  state.log.push(ev);
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

/**
 * Start a game from dealt hands.
 * leader: seat that leads (winner of the previous game), or null for a first
 * game, where the holder of 3♠ leads and must include 3♠ in the first play.
 */
export function newGame(hands, { settings = DEFAULT_SETTINGS, leader = null } = {}) {
  const n = hands.length;
  const state = {
    n,
    settings: clone(settings),
    hands: hands.map(sortByRank),
    turn: null,
    current: null,        // { seat, combo } — the play to beat this round
    passed: Array(n).fill(false),
    finished: [],         // seats in finishing order (index = place)
    requireThreeSpades: false,
    over: false,
    instantWin: null,     // { seat, code, label }
    eventId: 0,
    log: [],
  };

  const holder = state.hands.findIndex((h) => h.includes(THREE_SPADES));
  if (leader == null) {
    state.turn = holder >= 0 ? holder : 0;
    state.requireThreeSpades = holder >= 0;
  } else {
    state.turn = leader;
  }
  pushEvent(state, { type: 'start', seat: state.turn, threeSpades: state.requireThreeSpades });

  if (state.settings.instantWin) {
    // Ties go to the player closest to the 3♠ holder in turn order.
    const from = holder >= 0 ? holder : 0;
    let best = null;
    for (let i = 0; i < n; i++) {
      const seat = seatAfter(state, from, i);
      const win = detectInstantWin(state.hands[seat]);
      if (win && (!best || win.priority < best.win.priority)) best = { seat, win };
    }
    if (best) {
      state.instantWin = { seat: best.seat, code: best.win.code, label: best.win.label };
      state.finished = Array.from({ length: n }, (_, i) => seatAfter(state, best.seat, i));
      state.requireThreeSpades = false;
      pushEvent(state, { type: 'instantWin', seat: best.seat, label: best.win.label });
      endGame(state);
    }
  }
  return state;
}

/**
 * Can `seat` play `cards` right now?
 * Works on the full host state and on a player's view (viewFor), since it only
 * reads that player's own hand.
 * Returns { ok: true, combo, chop, outOfTurn } or { ok: false, reason }.
 */
export function validatePlay(state, seat, cards) {
  const fail = (reason) => ({ ok: false, reason });
  if (state.over) return fail('The game is over');
  if (isOut(state, seat)) return fail('You have already finished');
  if (!Array.isArray(cards) || cards.length === 0) return fail('Select cards to play');
  const hand = state.hands[seat] || [];
  if (!cards.every((c) => hand.includes(c))) return fail("You don't have those cards");

  const combo = detectCombo(cards);
  const cur = state.current ? state.current.combo : null;

  if (seat !== state.turn) {
    if (state.settings.chopAfterPass && state.passed[seat] && cur) {
      if (combo && isChop(combo, cur)) return { ok: true, combo, chop: true, outOfTurn: true };
      return fail(`You passed — you can only chop (chặt) the ${describeCombo(cur)}`);
    }
    return fail(state.passed[seat] ? 'You passed this round' : 'Not your turn');
  }
  if (!combo) return fail('Not a valid combination');
  if (state.requireThreeSpades && !cards.includes(THREE_SPADES)) return fail('First play must include 3♠');
  if (cur && !beats(combo, cur)) {
    return fail(`Must beat ${describeCombo(cur, true)}`);
  }
  return { ok: true, combo, chop: isChop(combo, cur), outOfTurn: false };
}

/** Why `seat` can't pass right now, or null if passing is allowed. */
export function passError(state, seat) {
  if (state.over) return 'The game is over';
  if (seat !== state.turn) return 'Not your turn';
  if (!state.current) return "You're leading — you must play something";
  return null;
}

/** Play cards. Throws Error(reason) if the move is illegal. `meta.auto` marks a timeout move. */
export function applyPlay(state, seat, cards, meta = {}) {
  const check = validatePlay(state, seat, cards);
  if (!check.ok) throw new Error(check.reason);
  const s = clone(state);
  const prev = s.current;
  const { combo } = check;

  s.hands[seat] = s.hands[seat].filter((c) => !combo.cards.includes(c));
  s.current = { seat, combo };
  s.passed[seat] = false;
  s.requireThreeSpades = false;
  pushEvent(s, {
    type: 'play',
    seat,
    cards: combo.cards,
    chop: check.chop,
    victim: check.chop ? prev.seat : null,
    auto: !!meta.auto,
  });

  if (s.hands[seat].length === 0) {
    s.finished.push(seat);
    pushEvent(s, { type: 'finish', seat, place: s.finished.length - 1 });
    const left = seatsInPlay(s);
    if (left.length <= 1) {
      for (const last of left) {
        s.finished.push(last);
        pushEvent(s, { type: 'finish', seat: last, place: s.finished.length - 1 });
      }
      endGame(s);
      return s;
    }
  }
  advanceTurn(s, seat);
  return s;
}

/** Pass for the rest of this round. Throws Error(reason) if not allowed. */
export function applyPass(state, seat, meta = {}) {
  const reason = passError(state, seat);
  if (reason) throw new Error(reason);
  const s = clone(state);
  s.passed[seat] = true;
  pushEvent(s, { type: 'pass', seat, auto: !!meta.auto });
  advanceTurn(s, seat);
  return s;
}

/** What to do when the current player's timer runs out. */
export function autoMove(state) {
  if (state.over || state.turn == null) return null;
  if (state.current) return { type: 'pass' };
  // Leading: play the lowest single (for the 3♠ holder that is 3♠ itself).
  return { type: 'play', cards: [sortByRank(state.hands[state.turn])[0]] };
}

function advanceTurn(s, actor) {
  for (let i = 1; i <= s.n; i++) {
    const p = seatAfter(s, actor, i);
    if (p === s.current.seat) break;
    if (!isOut(s, p) && !s.passed[p]) {
      s.turn = p;
      return;
    }
  }
  // Everyone else passed: the last player to play wins the round and leads.
  // If they have already finished, the lead goes to the next player in play.
  const winner = s.current.seat;
  const leader = isOut(s, winner) ? nextInPlay(s, winner) : winner;
  s.current = null;
  s.passed.fill(false);
  s.turn = leader;
  pushEvent(s, { type: 'roundWon', seat: winner, leader });
}

function endGame(s) {
  s.over = true;
  s.turn = null;
  pushEvent(s, { type: 'gameOver', places: [...s.finished] });
}

/** Points earned per seat, given the finishing order and the points per place. */
export function scoreDeltas(finished, points) {
  const deltas = Array(finished.length).fill(0);
  finished.forEach((seat, place) => { deltas[seat] = points[place] ?? 0; });
  return deltas;
}

/**
 * What `seat` is allowed to see: their own hand and the play on the table.
 * Other players' hands AND card counts are hidden (null) until the game ends,
 * when the last player's leftover cards (and an instant winner's hand) are
 * revealed. The event log keeps who did what, but not which cards were
 * played, so nobody can count cards from it.
 */
export function viewFor(state, seat) {
  const revealed = new Set();
  if (state.over) {
    revealed.add(state.finished[state.n - 1]);
    if (state.instantWin) revealed.add(state.instantWin.seat);
  }
  return {
    n: state.n,
    settings: clone(state.settings),
    turn: state.turn,
    current: clone(state.current),
    passed: [...state.passed],
    finished: [...state.finished],
    requireThreeSpades: state.requireThreeSpades,
    over: state.over,
    instantWin: clone(state.instantWin),
    eventId: state.eventId,
    log: state.log.slice(-VIEW_LOG).map(({ cards, ...event }) => ({ ...event })),
    counts: state.hands.map((h, i) => (i === seat || state.over ? h.length : null)),
    hands: state.hands.map((h, i) => (i === seat || revealed.has(i) ? [...h] : null)),
  };
}

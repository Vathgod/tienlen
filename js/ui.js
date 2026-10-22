/**
 * ui.js — everything that touches the DOM.
 *
 * render(view) draws a snapshot coming from the host (see buildView in
 * main.js). Local-only state (selected cards, sort mode, which animations
 * already played) lives in `ui` below. User actions are reported through
 * the handlers passed to init().
 */
import {
  RANKS, SUITS, PLACE_NAMES, rankOf, suitOf, isRedCard, sortByRank, sortBySuit,
  validatePlay, passError, describeCombo, isSuitless,
} from './game.js';

const $ = (sel) => document.querySelector(sel);
const POSITIONS = { 1: 'right', 2: 'top', 3: 'left' }; // seat offset from me → where they sit
const PLACE_SHORT = ['1st · Nhất', '2nd · Nhì', '3rd · Ba', '4th · Bét'];
const SUIT_WORDS = ['spades', 'clubs', 'diamonds', 'hearts'];

const ui = {
  h: null,
  view: null,
  screen: null,
  nameMode: 'create',
  fromLink: false,
  selected: new Set(),
  sortMode: readPref('tl-sort') === 'suit' ? 'suit' : 'rank',
  gameNo: null,
  lastEventId: 0,
  lastNoticeId: null,
  centerKey: '',
  pending: false,
  timerBase: null,
  endHidden: false,
  endReady: {},
};

function readPref(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writePref(key, value) { try { localStorage.setItem(key, value); } catch { /* ignore */ } }

/* ───────────────────────── Text helpers ───────────────────────── */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// U+FE0E asks for the text glyph, so iPhones don't turn ♥ ♦ into emoji.
const textSuits = (s) => String(s).replace(/[♠♣♦♥]/g, (m) => `${m}︎`);
const nameOf = (view, seat) => (view.seats[seat] ? view.seats[seat].name : `Seat ${seat + 1}`);
const who = (view, seat) => (seat === view.mySeat ? 'You' : esc(nameOf(view, seat)));
const initial = (name) => esc((Array.from(name.trim())[0] || '?').toUpperCase());

/* ───────────────────────── Cards ───────────────────────── */

function cardHtml(card, { button = false, selected = false } = {}) {
  const rank = RANKS[rankOf(card)];
  const suit = textSuits(SUITS[suitOf(card)]);
  const color = isRedCard(card) ? 'red' : 'black';
  const face = `<span class="corner"><b>${rank}</b><i>${suit}</i></span><span class="pip">${suit}</span><span class="corner br"><b>${rank}</b><i>${suit}</i></span>`;
  if (!button) return `<div class="card ${color}">${face}</div>`;
  return `<button type="button" class="card ${color}${selected ? ' selected' : ''}" data-card="${card}" aria-pressed="${selected}" aria-label="${rank} of ${SUIT_WORDS[suitOf(card)]}">${face}</button>`;
}

const cardsHtml = (cards) => sortByRank(cards).map((c) => cardHtml(c)).join('');

/** Overlap cards in a row so they always fit the container width. */
function layoutRow(el) {
  const cards = el.children;
  if (!cards.length) return;
  const cardW = cards[0].offsetWidth;
  const style = getComputedStyle(el);
  const avail = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const natural = cardW + 6;
  const n = cards.length;
  let stepPx = n > 1 ? Math.min(natural, (avail - cardW) / (n - 1)) : natural;
  stepPx = Math.max(stepPx, Math.min(14, natural));
  el.style.setProperty('--overlap', `${Math.floor(stepPx - cardW)}px`);
}

/* ───────────────────────── Screens & overlays ───────────────────────── */

function showScreen(name) {
  if (ui.screen === name) return;
  ui.screen = name;
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === `screen-${name}`));
}

export function toast(text, kind = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = textSuits(text);
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 3000);
  setTimeout(() => el.remove(), 3500);
}

export function showMessage(title, text, buttons = [], { spinner = false } = {}) {
  $('#msg-title').textContent = title;
  $('#msg-text').textContent = text;
  $('#msg-spinner').hidden = !spinner;
  const box = $('#msg-buttons');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn${b.primary ? ' primary' : ''}`;
    btn.textContent = b.label;
    btn.addEventListener('click', b.action);
    box.appendChild(btn);
  }
  $('#msg-overlay').hidden = false;
}

export function hideMessage() {
  $('#msg-overlay').hidden = true;
}

function showChop(text) {
  const fx = $('#chop-fx');
  $('#chop-sub').textContent = text;
  fx.classList.remove('show');
  void fx.offsetWidth; // restart the animation
  fx.classList.add('show');
  const table = $('#table');
  table.classList.remove('shake');
  void table.offsetWidth;
  table.classList.add('shake');
}

/* ───────────────────────── Name / join form ───────────────────────── */

function showNameForm(mode, code = '') {
  ui.nameMode = mode;
  const join = mode === 'join';
  $('#name-title').textContent = join ? 'Join a room' : 'Create a room';
  $('#name-sub').textContent = join && ui.fromLink ? `You're invited to room ${code}.` : join ? 'Enter the room code your friend sent you.' : 'You will be the host. Keep this tab open while you play.';
  $('#code-field').hidden = !join || ui.fromLink;
  $('#input-code').value = code;
  $('#btn-name-go').textContent = join ? 'Join' : 'Create Room';
  $('#name-error').textContent = '';
  setFormBusy(false);
  showScreen('name');
  setTimeout(() => $('#input-name').focus(), 50);
}

function setFormBusy(busy) {
  const go = $('#btn-name-go');
  go.disabled = busy;
  if (busy) go.textContent = 'Connecting…';
  else go.textContent = ui.nameMode === 'join' ? 'Join' : 'Create Room';
}

/* ───────────────────────── Lobby ───────────────────────── */

function renderLobby(view) {
  const isHost = view.role === 'host';
  $('#lobby-code').textContent = view.code || '······';
  const link = view.code ? ui.h.inviteLink(view.code) : '';
  $('#invite-link').value = link;
  $('#btn-share').hidden = !navigator.share;

  $('#lobby-seats').innerHTML = view.seats.map((s, i) => {
    if (!s) {
      return `<li class="seat empty"><span class="avatar empty">${i + 1}</span><span class="seat-name">Waiting for player…</span></li>`;
    }
    const tags = [
      s.isHost ? '<span class="tag gold">Host</span>' : '',
      i === view.mySeat ? '<span class="tag">You</span>' : '',
      s.connected ? '' : '<span class="tag off">Offline</span>',
    ].join('');
    const kick = isHost && !s.isHost
      ? `<button type="button" class="icon-btn kick" data-kick="${i}" title="Remove ${esc(s.name)}" aria-label="Remove ${esc(s.name)}">✕</button>`
      : '';
    return `<li class="seat${i === view.mySeat ? ' me' : ''}"><span class="avatar">${initial(s.name)}</span><span class="seat-name">${esc(s.name)} ${tags}</span><span class="seat-score">${s.score} pts</span>${kick}</li>`;
  }).join('');

  const filled = view.seats.filter(Boolean).length;
  const start = $('#btn-start');
  start.hidden = !isHost;
  start.disabled = filled < 4;
  $('#lobby-status').textContent = filled < 4
    ? `${filled}/4 players — waiting for ${4 - filled} more. Send the invite link to your friends.`
    : isHost ? 'Everyone is here. Start when ready!' : 'Everyone is here. Waiting for the host to start…';

  syncSettings(view.settings, isHost);
}

function syncSettings(settings, isHost) {
  const form = $('#settings');
  form.classList.toggle('readonly', !isHost);
  const set = (name, value) => {
    const el = form.elements[name];
    el.disabled = !isHost;
    if (document.activeElement === el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
  };
  set('turnSeconds', settings.turnSeconds);
  set('instantWin', settings.instantWin);
  set('chopAfterPass', settings.chopAfterPass);
  set('direction', settings.direction);
  settings.points.forEach((p, i) => set(`p${i}`, p));
}

function readSettings() {
  const f = $('#settings').elements;
  const clampPts = (v) => Math.max(-99, Math.min(99, Math.round(Number(v) || 0)));
  return {
    turnSeconds: Number(f.turnSeconds.value) || 0,
    instantWin: f.instantWin.checked,
    chopAfterPass: f.chopAfterPass.checked,
    direction: f.direction.value === 'cw' ? 'cw' : 'ccw',
    points: [0, 1, 2, 3].map((i) => clampPts(f[`p${i}`].value)),
  };
}

/* ───────────────────────── Game table ───────────────────────── */

function renderGame(view) {
  const g = view.game;
  const me = view.mySeat;
  const isHost = view.role === 'host';

  // New game? Reset per-game UI state. Joining mid-game: don't replay old animations.
  if (ui.gameNo !== view.gameNo) {
    ui.gameNo = view.gameNo;
    ui.selected.clear();
    ui.endHidden = false;
    ui.lastEventId = g.eventId > 3 ? g.eventId : 0;
  }
  const events = g.log.filter((e) => e.id > ui.lastEventId);
  ui.lastEventId = g.eventId;
  ui.justEnded = events.some((e) => e.type === 'gameOver');
  ui.pending = false;

  $('#game-code').textContent = view.code;
  $('#btn-lobby').hidden = !isHost;
  $('#btn-results').hidden = !(view.phase === 'ended' && ui.endHidden);

  // Opponents
  for (let offset = 1; offset < 4; offset++) {
    const seat = (me + offset) % 4;
    renderOpponent($(`#opp-${POSITIONS[offset]}`), view, seat);
  }

  // Center: the play to beat
  const center = $('#center');
  if (g.current) {
    const key = `${view.gameNo}:${g.current.seat}:${g.current.combo.top}:${g.current.combo.size}`;
    const fresh = key !== ui.centerKey;
    ui.centerKey = key;
    center.innerHTML = `<div class="cards-row played${fresh ? ' fresh' : ''}">${cardsHtml(g.current.combo.cards)}</div>
      <div class="played-by"><b>${who(view, g.current.seat)}</b> · ${esc(textSuits(describeCombo(g.current.combo)))}</div>`;
    layoutRow(center.querySelector('.played'));
  } else {
    ui.centerKey = '';
    let msg = 'Game over';
    if (!g.over && g.turn != null) {
      const leader = g.turn === me ? 'You lead' : `${esc(nameOf(view, g.turn))} leads`;
      msg = g.requireThreeSpades
        ? `${leader} — first play must include ${textSuits('3♠')}`
        : `${leader} a new round`;
    }
    center.innerHTML = `<div class="center-msg">${msg}</div>`;
  }

  // Me
  const myPlace = g.finished.indexOf(me);
  const meEl = $('#me');
  meEl.classList.toggle('turn', g.turn === me && !g.over);
  $('#me-name').textContent = nameOf(view, me);
  $('#me-score').textContent = `${view.seats[me].score} pts`;
  $('#me-place').hidden = myPlace < 0;
  $('#me-place').textContent = myPlace >= 0 ? PLACE_SHORT[myPlace] : '';
  $('#me-place').className = `badge place-${myPlace}`;
  $('#btn-sort').textContent = ui.sortMode === 'suit' ? 'Sort: suit' : 'Sort: rank';

  const hand = g.hands[me] || [];
  for (const c of [...ui.selected]) if (!hand.includes(c)) ui.selected.delete(c);
  const sorted = ui.sortMode === 'suit' ? sortBySuit(hand) : sortByRank(hand);
  const handEl = $('#hand');
  handEl.innerHTML = sorted.map((c) => cardHtml(c, { button: true, selected: ui.selected.has(c) })).join('');
  layoutRow(handEl);
  refreshControls();

  // Timer
  ui.timerBase = g.turnRemainingMs != null
    ? { at: performance.now(), remaining: g.turnRemainingMs, total: g.turnTotalMs, turn: g.turn }
    : null;
  tickTimer();

  playEvents(view, events);
}

function renderOpponent(el, view, seat) {
  const g = view.game;
  const s = view.seats[seat];
  const place = g.finished.indexOf(seat);
  const passed = g.passed[seat] && !!g.current && place < 0;
  el.className = `opp opp-${el.dataset.pos}${g.turn === seat && !g.over ? ' turn' : ''}${passed ? ' passed' : ''}${place >= 0 ? ' done' : ''}${s && !s.connected ? ' offline' : ''}`;
  const name = s ? s.name : '—';
  // Card counts are secret: still-playing opponents just show a few card backs.
  const cards = place >= 0
    ? `<span class="badge place-${place}">${PLACE_SHORT[place]}</span>`
    : '<span class="backs"><i></i><i></i><i></i></span>';
  const tags = [
    s && !s.connected ? '<span class="tag off">Offline</span>' : '',
    passed ? '<span class="tag">Passed</span>' : '',
  ].join('');
  el.innerHTML = `<div class="opp-head"><span class="avatar">${initial(name)}</span><span class="opp-name">${esc(name)}</span></div>
    <div class="opp-cards">${cards}</div>
    <div class="opp-meta"><span class="opp-score">${s ? s.score : 0} pts</span>${tags}</div>
    <div class="timer-bar"><i></i></div>`;
}

function refreshControls() {
  const view = ui.view;
  if (!view || !view.game) return;
  const g = view.game;
  const me = view.mySeat;
  const sel = [...ui.selected];
  const check = sel.length ? validatePlay(g, me, sel) : null;
  const canPlay = !!(check && check.ok) && !ui.pending;
  const passErr = passError(g, me);

  const play = $('#btn-play');
  play.disabled = !canPlay;
  play.title = textSuits(check ? (check.ok ? `Play ${describeCombo(check.combo)}` : check.reason) : 'Select cards to play');
  play.classList.toggle('chop', !!(check && check.ok && check.chop));
  play.textContent = check && check.ok && check.chop ? 'Chặt!' : 'Play';

  const pass = $('#btn-pass');
  pass.disabled = !!passErr || ui.pending;
  pass.title = passErr ? textSuits(passErr) : 'Pass for the rest of this round (Bỏ lượt)';

  const myPlace = g.finished.indexOf(me);
  let hint = '';
  let kind = '';
  if (g.over) {
    hint = 'Game over';
  } else if (myPlace >= 0) {
    hint = `You finished ${PLACE_NAMES[myPlace]}! Watching the others…`;
  } else if (check && !check.ok) {
    hint = check.reason;
    kind = 'warn';
  } else if (check && check.ok) {
    hint = `${describeCombo(check.combo)}${check.chop ? ' — CHẶT!' : ''}`;
    kind = 'ok';
  } else if (g.turn === me) {
    hint = g.current
      ? `Your turn — ${isSuitless(g.current.combo.top) ? 'match or beat' : 'beat'} the ${describeCombo(g.current.combo, true)}, or pass`
      : g.requireThreeSpades ? 'Your turn — lead with a combination that includes 3♠' : 'Your turn — lead any combination';
    kind = 'turn';
  } else if (g.passed[me] && g.current) {
    hint = g.settings.chopAfterPass ? 'You passed — you can still chop (chặt) with a bomb' : 'You passed — wait for the next round';
  } else if (g.turn != null) {
    hint = `Waiting for ${nameOf(view, g.turn)}…`;
  }
  const hintEl = $('#hint');
  hintEl.textContent = textSuits(hint);
  hintEl.className = `hint ${kind}`;
}

function tickTimer() {
  const view = ui.view;
  const base = ui.timerBase;
  const meTimer = $('#me-timer');
  document.querySelectorAll('.opp .timer-bar i').forEach((i) => { i.style.width = '0'; });
  if (!view || !view.game || !base || view.phase !== 'playing') {
    meTimer.hidden = true;
    return;
  }
  const left = Math.max(0, base.remaining - (performance.now() - base.at));
  const pct = base.total ? (left / base.total) * 100 : 0;
  const secs = Math.ceil(left / 1000);
  if (base.turn === view.mySeat) {
    meTimer.hidden = false;
    meTimer.textContent = `⏱ ${secs}s`;
    meTimer.classList.toggle('urgent', secs <= 5);
  } else {
    meTimer.hidden = true;
    const offset = (base.turn - view.mySeat + 4) % 4;
    const bar = document.querySelector(`#opp-${POSITIONS[offset]} .timer-bar i`);
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.classList.toggle('urgent', secs <= 5);
    }
  }
}

function playEvents(view, events) {
  for (const e of events) {
    if (e.type === 'play' && e.chop) {
      showChop(`${nameOf(view, e.seat)} chopped ${nameOf(view, e.victim)}`);
    } else if (e.type === 'finish' && view.game.finished.length < 4) {
      toast(e.seat === view.mySeat ? `You finished ${PLACE_NAMES[e.place]}!` : `${nameOf(view, e.seat)} finished ${PLACE_NAMES[e.place]}`, 'good');
    } else if (e.type === 'pass') {
      const offset = (e.seat - view.mySeat + 4) % 4;
      const el = offset ? $(`#opp-${POSITIONS[offset]}`) : null;
      if (el) el.insertAdjacentHTML('beforeend', '<span class="bubble">Pass</span>');
    }
  }
}

/* ───────────────────────── End of game ───────────────────────── */

function renderEnd(view) {
  const overlay = $('#end-overlay');
  if (view.phase !== 'ended' || !view.result) {
    overlay.hidden = true;
    return;
  }
  // Let players see the last card land before the results cover the table.
  if (!(view.gameNo in ui.endReady)) {
    const delay = ui.justEnded ? (view.result.instantWin ? 600 : 1600) : 0;
    ui.endReady[view.gameNo] = performance.now() + delay;
  }
  const wait = ui.endReady[view.gameNo] - performance.now();
  if (wait > 0) {
    overlay.hidden = true;
    setTimeout(() => ui.view && ui.view.gameNo === view.gameNo && renderEnd(ui.view), wait + 20);
    return;
  }
  $('#btn-results').hidden = !ui.endHidden;
  if (ui.endHidden) {
    overlay.hidden = true;
    return;
  }

  const g = view.game;
  const { result } = view;
  const isHost = view.role === 'host';
  const iw = result.instantWin;
  $('#end-title').textContent = iw ? 'Instant win! (Tới trắng)' : 'Game over';
  $('#end-instant').hidden = !iw;
  if (iw) $('#end-instant').innerHTML = `<b>${who(view, iw.seat)}</b> ${iw.seat === view.mySeat ? 'hold' : 'holds'} <b>${esc(iw.label)}</b>`;

  $('#end-ranking').innerHTML = result.places.map((p, place) => {
    const total = view.seats[p.seat] ? view.seats[p.seat].score : p.total;
    const delta = p.delta > 0 ? `+${p.delta}` : `${p.delta}`;
    return `<li class="place-${place}${p.seat === view.mySeat ? ' me' : ''}">
      <span class="medal">${place + 1}</span>
      <span class="rk-place">${PLACE_NAMES[place]}</span>
      <span class="rk-name">${esc(p.name)}${p.seat === view.mySeat ? ' <span class="tag">You</span>' : ''}</span>
      <span class="rk-delta ${p.delta >= 0 ? 'pos' : 'neg'}">${delta}</span>
      <span class="rk-total">${total} pts</span></li>`;
  }).join('');

  // The host only reveals the last player's leftovers (and an instant winner's hand).
  const revealSeats = [...new Set([iw ? iw.seat : null, g.finished[g.n - 1]])]
    .filter((seat) => seat != null && g.hands[seat] && g.hands[seat].length);
  $('#end-reveal').innerHTML = revealSeats.map((seat) => ({ seat, h: g.hands[seat] })).map(({ h, seat }) => `
    <div class="reveal">
      <div class="reveal-title">${iw && iw.seat === seat ? `${who(view, seat)}'s winning hand` : `${who(view, seat)} — cards left (${h.length})`}</div>
      <div class="cards-row small">${cardsHtml(h)}</div>
    </div>`).join('');
  overlay.hidden = false;
  overlay.querySelectorAll('.cards-row').forEach(layoutRow);

  $('#end-host').hidden = !isHost;
  $('#end-guest').hidden = isHost;
}

/* ───────────────────────── Public API ───────────────────────── */

export function render(view) {
  const first = ui.view == null;
  ui.view = view;

  // Join/leave/disconnect notices → toasts (skip the backlog on first view).
  const notices = view.notices || [];
  const maxId = notices.length ? notices[notices.length - 1].id : 0;
  if (!first && ui.lastNoticeId != null) {
    notices.filter((n) => n.id > ui.lastNoticeId).forEach((n) => toast(n.text, n.text.includes('disconnected') ? 'error' : 'info'));
  }
  ui.lastNoticeId = maxId;

  if (view.phase === 'lobby' || !view.game) {
    $('#end-overlay').hidden = true;
    ui.gameNo = null;
    showScreen('lobby');
    renderLobby(view);
  } else {
    showScreen('game');
    renderGame(view);
    renderEnd(view);
  }
}

export function init(handlers) {
  ui.h = handlers;

  // Home
  $('#btn-create').addEventListener('click', () => { ui.fromLink = false; showNameForm('create'); });
  $('#btn-join').addEventListener('click', () => { ui.fromLink = false; showNameForm('join'); });

  // Name form
  $('#input-code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  $('#btn-name-back').addEventListener('click', () => {
    if (ui.fromLink) window.location.href = window.location.pathname;
    else showScreen('home');
  });
  $('#name-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#name-error').textContent = '';
    setFormBusy(true);
    try {
      await ui.h.onSubmitName({ mode: ui.nameMode, name: $('#input-name').value, code: $('#input-code').value });
    } catch (err) {
      $('#name-error').textContent = err.message;
      setFormBusy(false);
    }
  });

  // Lobby
  $('#btn-copy').addEventListener('click', async () => {
    const input = $('#invite-link');
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    toast('Invite link copied — send it to your friends', 'good');
  });
  $('#btn-share').addEventListener('click', () => {
    navigator.share({ title: 'Tiến Lên', text: 'Join my Tiến Lên game!', url: $('#invite-link').value }).catch(() => {});
  });
  $('#lobby-seats').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kick]');
    if (btn) ui.h.onKick(Number(btn.dataset.kick));
  });
  $('#settings').addEventListener('change', () => ui.h.onSettings(readSettings()));
  $('#settings').addEventListener('submit', (e) => e.preventDefault());
  $('#btn-start').addEventListener('click', () => ui.h.onStart());
  $('#btn-leave-lobby').addEventListener('click', () => ui.h.onLeave());

  // Game
  $('#hand').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-card]');
    if (!btn) return;
    const card = Number(btn.dataset.card);
    if (ui.selected.has(card)) ui.selected.delete(card);
    else ui.selected.add(card);
    btn.classList.toggle('selected', ui.selected.has(card));
    btn.setAttribute('aria-pressed', ui.selected.has(card));
    refreshControls();
  });
  $('#btn-play').addEventListener('click', () => {
    if (!ui.view || !ui.view.game || ui.pending) return;
    const cards = [...ui.selected];
    const check = validatePlay(ui.view.game, ui.view.mySeat, cards);
    if (!check.ok) { toast(check.reason, 'error'); return; }
    ui.pending = true;
    refreshControls();
    setTimeout(() => { ui.pending = false; refreshControls(); }, 2000);
    ui.h.onPlay(cards);
  });
  $('#btn-pass').addEventListener('click', () => {
    if (ui.pending) return;
    ui.selected.clear();
    ui.pending = true;
    setTimeout(() => { ui.pending = false; refreshControls(); }, 2000);
    ui.h.onPass();
  });
  $('#btn-sort').addEventListener('click', () => {
    ui.sortMode = ui.sortMode === 'rank' ? 'suit' : 'rank';
    writePref('tl-sort', ui.sortMode);
    if (ui.view && ui.view.game) renderGame(ui.view);
  });
  $('#btn-clear').addEventListener('click', () => {
    ui.selected.clear();
    document.querySelectorAll('#hand .card.selected').forEach((el) => {
      el.classList.remove('selected');
      el.setAttribute('aria-pressed', 'false');
    });
    refreshControls();
  });
  $('#btn-leave-game').addEventListener('click', () => ui.h.onLeave());
  $('#btn-lobby').addEventListener('click', () => {
    const playing = ui.view && ui.view.phase === 'playing';
    if (playing && !window.confirm('End this game and go back to the lobby? No points will be given.')) return;
    ui.h.onBackToLobby();
  });
  $('#btn-results').addEventListener('click', () => {
    ui.endHidden = false;
    if (ui.view) renderEnd(ui.view);
  });

  // End overlay
  $('#end-hide').addEventListener('click', () => {
    ui.endHidden = true;
    if (ui.view) renderEnd(ui.view);
  });
  $('#btn-next').addEventListener('click', () => ui.h.onNextGame());
  $('#btn-reset').addEventListener('click', () => {
    if (window.confirm('Reset everyone\'s score to 0?')) ui.h.onResetScores();
  });
  $('#btn-to-lobby').addEventListener('click', () => ui.h.onBackToLobby());

  // Keep card rows fitted to the screen.
  const relayout = () => document.querySelectorAll('.cards-row').forEach(layoutRow);
  window.addEventListener('resize', relayout);
  if ('ResizeObserver' in window) new ResizeObserver(relayout).observe($('#table'));

  setInterval(tickTimer, 250);
}

export function start({ savedName, roomFromLink }) {
  $('#input-name').value = savedName;
  if (roomFromLink) {
    ui.fromLink = true;
    showNameForm('join', roomFromLink);
  } else {
    showScreen('home');
  }
}

/**
 * main.js — app controller.
 *
 * HostRoom   runs in the host's browser: seats, settings, scores, the
 *            authoritative game state and the turn timer. It sends every
 *            player a personalised snapshot (buildView) after each change.
 * GuestClient runs in a guest's browser: sends actions, renders snapshots.
 *
 * Both feed the same snapshot shape into ui.render(), so the host's own
 * screen works exactly like a guest's.
 */
import * as G from './game.js';
import { HostNetwork, GuestNetwork, normalizeCode, CODE_LENGTH } from './network.js';
import * as UI from './ui.js';

const SEATS = 4;
const MAX_NAME = 16;
const AWAY_TURN_SECONDS = 30; // with the timer off, a disconnected player is auto-played after this

const store = {
  get(area, key) { try { return window[area].getItem(key); } catch { return null; } },
  set(area, key, value) { try { window[area].setItem(key, value); } catch { /* storage blocked */ } },
};

/** Random id for this browser tab (survives refresh, distinct per tab). */
function clientId() {
  let id = store.get('sessionStorage', 'tl-client-id');
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    store.set('sessionStorage', 'tl-client-id', id);
  }
  return id;
}

const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
const nameKey = (name) => cleanName(name).toLocaleLowerCase();
const sameName = (a, b) => nameKey(a) === nameKey(b);

function toCardList(cards) {
  if (!Array.isArray(cards) || cards.length > 13) return null;
  if (!cards.every((c) => Number.isInteger(c) && c >= 0 && c < 52)) return null;
  return new Set(cards).size === cards.length ? cards : null;
}

const REJECT_TEXT = {
  full: 'This room is full (4/4 players).',
  'in-progress':
    'A game is already in progress in this room. If you were playing and got disconnected, wait a few seconds and join again with the same name.',
  'name-taken': 'Someone in this room already uses that name. Pick another one.',
  'bad-name': 'Please enter a name.',
};

/* ═════════════════════════ Host ═════════════════════════ */

class HostRoom {
  constructor(hostName) {
    this.net = new HostNetwork({
      onMessage: (id, msg) => this.onMessage(id, msg),
      onDisconnect: (id) => this.onDisconnect(id),
    });
    this.code = null;
    this.phase = 'lobby'; // 'lobby' | 'playing' | 'ended'
    this.seats = Array(SEATS).fill(null);
    this.seats[0] = { name: hostName, clientId: clientId(), connId: null, connected: true, isHost: true };
    this.settings = JSON.parse(JSON.stringify(G.DEFAULT_SETTINGS));
    this.scores = {}; // nameKey → points, kept for the life of the room
    this.game = null;
    this.gameNo = 0;
    this.result = null;
    this.lastWinnerName = null;
    this.notices = [];
    this.noticeId = 0;
    this.deadline = null;
    this.timerKey = null;
    this.timer = null;
    this.onView = () => {};
  }

  async open() {
    this.code = await this.net.open();
    this.publish();
  }

  seatOfConn(connId) {
    return this.seats.findIndex((s) => s && s.connId === connId);
  }

  notice(text) {
    this.notices.push({ id: ++this.noticeId, text });
    if (this.notices.length > 10) this.notices.shift();
  }

  /* ── messages from guests ── */

  onMessage(connId, msg) {
    const seat = this.seatOfConn(connId);
    switch (msg.t) {
      case 'join': this.onJoin(connId, msg); break;
      case 'play': if (seat > 0) this.act(seat, { type: 'play', cards: msg.cards }); break;
      case 'pass': if (seat > 0) this.act(seat, { type: 'pass' }); break;
      case 'leave':
        this.net.closeConn(connId);
        this.onDisconnect(connId, true);
        break;
      default: break;
    }
  }

  onJoin(connId, msg) {
    const name = cleanName(msg.name);
    const cid = String(msg.clientId || '');
    if (!name) return this.reject(connId, 'bad-name');

    // Same browser tab coming back (refresh or dropped connection)?
    let seat = this.seats.findIndex((s) => s && !s.isHost && cid && s.clientId === cid);
    // During a game, a disconnected player can reclaim their seat by name.
    if (seat < 0 && this.phase !== 'lobby') {
      seat = this.seats.findIndex((s) => s && !s.isHost && !s.connected && sameName(s.name, name));
    }

    if (seat >= 0) {
      const s = this.seats[seat];
      if (this.phase === 'lobby' && !sameName(s.name, name)) {
        if (this.seats.some((o, i) => o && i !== seat && sameName(o.name, name))) return this.reject(connId, 'name-taken');
        s.name = name;
      }
      if (s.connId && s.connId !== connId) this.net.closeConn(s.connId);
      const wasAway = !s.connected;
      Object.assign(s, { connId, clientId: cid, connected: true });
      if (wasAway) this.notice(`${s.name} reconnected`);
    } else {
      if (this.phase !== 'lobby') return this.reject(connId, 'in-progress');
      if (this.seats.some((s) => s && sameName(s.name, name))) return this.reject(connId, 'name-taken');
      seat = this.seats.indexOf(null);
      if (seat < 0) return this.reject(connId, 'full');
      this.seats[seat] = { name, clientId: cid, connId, connected: true, isHost: false };
      this.notice(`${name} joined`);
    }
    this.net.send(connId, { t: 'welcome', seat });
    this.scheduleTimer();
    this.publish();
  }

  reject(connId, reason) {
    this.net.closeConn(connId, { t: 'reject', reason });
  }

  onDisconnect(connId, leftOnPurpose = false) {
    const seat = this.seatOfConn(connId);
    if (seat < 0) return;
    const s = this.seats[seat];
    if (this.phase === 'lobby') {
      this.seats[seat] = null;
      this.notice(`${s.name} left`);
    } else {
      Object.assign(s, { connId: null, connected: false });
      this.notice(`${s.name} ${leftOnPurpose ? 'left' : 'disconnected'} — they can rejoin with the same name`);
    }
    this.scheduleTimer();
    this.publish();
  }

  /* ── host controls ── */

  kick(seat) {
    const s = this.seats[seat];
    if (this.phase !== 'lobby' || !s || s.isHost) return;
    if (s.connId) this.net.closeConn(s.connId, { t: 'kicked' });
    this.seats[seat] = null;
    this.notice(`${s.name} was removed`);
    this.publish();
  }

  updateSettings(patch) {
    if (this.phase !== 'lobby') return;
    this.settings = { ...this.settings, ...patch };
    this.publish();
  }

  startGame() {
    if (this.seats.some((s) => !s)) return;
    const leader = this.lastWinnerName ? this.seats.findIndex((s) => sameName(s.name, this.lastWinnerName)) : -1;
    this.game = G.newGame(G.deal(SEATS), { settings: this.settings, leader: leader >= 0 ? leader : null });
    this.gameNo += 1;
    this.phase = 'playing';
    this.result = null;
    this.afterGameChange();
  }

  resetScores() {
    this.scores = {};
    if (this.result) this.result.places.forEach((p) => { p.total = 0; });
    this.publish();
  }

  backToLobby() {
    clearTimeout(this.timer);
    this.deadline = null;
    this.phase = 'lobby';
    this.game = null;
    this.result = null;
    this.seats = this.seats.map((s) => (s && !s.connected ? null : s));
    this.publish();
  }

  close() {
    clearTimeout(this.timer);
    this.net.destroy({ t: 'host-left' });
  }

  /* ── game actions ── */

  /** Apply an action for `seat`. Errors go back to that player only. */
  act(seat, action, meta = {}) {
    if (this.phase !== 'playing' || !this.game) return;
    try {
      if (action.type === 'play') {
        const cards = toCardList(action.cards);
        if (!cards) throw new Error('Invalid cards');
        this.game = G.applyPlay(this.game, seat, cards, meta);
      } else if (action.type === 'pass') {
        this.game = G.applyPass(this.game, seat, meta);
      } else {
        return;
      }
    } catch (err) {
      this.sendError(seat, err.message);
      return;
    }
    this.afterGameChange();
  }

  sendError(seat, message) {
    if (seat === 0) UI.toast(message, 'error');
    else if (this.seats[seat]?.connId) this.net.send(this.seats[seat].connId, { t: 'error', message });
  }

  afterGameChange() {
    if (this.game.over && this.phase === 'playing') this.finishGame();
    this.scheduleTimer();
    this.publish();
  }

  finishGame() {
    const { finished, settings } = this.game;
    const deltas = G.scoreDeltas(finished, settings.points);
    for (const s of this.seats) {
      const key = nameKey(s.name);
      this.scores[key] = (this.scores[key] || 0) + deltas[this.seats.indexOf(s)];
    }
    this.result = {
      instantWin: this.game.instantWin,
      places: finished.map((seat) => ({
        seat,
        name: this.seats[seat].name,
        delta: deltas[seat],
        total: this.scores[nameKey(this.seats[seat].name)],
      })),
    };
    this.lastWinnerName = this.seats[finished[0]].name;
    this.phase = 'ended';
  }

  /* ── turn timer (host clock is the only one that matters) ── */

  scheduleTimer() {
    clearTimeout(this.timer);
    const g = this.game;
    if (this.phase !== 'playing' || !g || g.over || g.turn == null) {
      this.deadline = null;
      return;
    }
    const key = `${this.gameNo}:${g.eventId}`;
    const away = !this.seats[g.turn]?.connected;
    const seconds = g.settings.turnSeconds > 0 ? g.settings.turnSeconds : away ? AWAY_TURN_SECONDS : 0;
    if (!seconds) {
      this.deadline = null;
      this.timerKey = key;
      return;
    }
    if (this.timerKey !== key || this.deadline == null) {
      this.deadline = Date.now() + seconds * 1000;
      this.timerKey = key;
      this.timerTotal = seconds * 1000;
    }
    this.timer = setTimeout(() => this.onTimeout(key), Math.max(0, this.deadline - Date.now()));
  }

  onTimeout(key) {
    if (key !== this.timerKey || this.phase !== 'playing') return;
    const move = G.autoMove(this.game);
    if (move) this.act(this.game.turn, move, { auto: true });
  }

  /* ── snapshots ── */

  buildView(seat) {
    return {
      role: seat === 0 ? 'host' : 'guest',
      code: this.code,
      phase: this.phase,
      mySeat: seat,
      gameNo: this.gameNo,
      seats: this.seats.map((s) => s && {
        name: s.name,
        connected: s.connected,
        isHost: s.isHost,
        score: this.scores[nameKey(s.name)] || 0,
      }),
      settings: this.settings,
      game: this.game && {
        ...G.viewFor(this.game, seat),
        turnRemainingMs: this.deadline ? Math.max(0, this.deadline - Date.now()) : null,
        turnTotalMs: this.deadline ? this.timerTotal : null,
      },
      result: this.result,
      notices: this.notices,
    };
  }

  publish() {
    this.seats.forEach((s, seat) => {
      if (seat > 0 && s && s.connected && s.connId) this.net.send(s.connId, { t: 'view', view: this.buildView(seat) });
    });
    this.onView(this.buildView(0));
  }
}

/* ═════════════════════════ Guest ═════════════════════════ */

class GuestClient {
  constructor(code, name) {
    this.code = code;
    this.name = name;
    this.seat = null;
    this.ended = false;
    this.net = new GuestNetwork({
      onMessage: (msg) => this.onMessage(msg),
      onLost: () => this.onLost(),
    });
    this.onView = () => {};
  }

  async join() {
    await this.net.connect(this.code);
    this.net.send({ t: 'join', name: this.name, clientId: clientId() });
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'welcome': this.seat = msg.seat; break;
      case 'view': this.onView(msg.view); break;
      case 'error': UI.toast(msg.message, 'error'); break;
      case 'reject': this.fatal("Couldn't join", REJECT_TEXT[msg.reason] || 'The host refused the connection.'); break;
      case 'kicked': this.fatal('Removed from room', 'The host removed you from the room.'); break;
      case 'host-left': this.fatal('Host left, game ended', 'The host closed the room.'); break;
      default: break;
    }
  }

  async onLost() {
    if (this.ended) return;
    if (this.seat == null) {
      this.fatal('Connection lost', 'Lost the connection to the host.');
      return;
    }
    UI.showMessage('Connection lost', 'Reconnecting to the host…', [], { spinner: true });
    for (let attempt = 0; attempt < 4 && !this.ended; attempt++) {
      try {
        await this.join();
        UI.hideMessage();
        return;
      } catch (err) {
        if (err.type === 'peer-unavailable') break;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (this.ended) return;
    this.ended = true;
    UI.showMessage('Host left, game ended', 'The connection to the host was lost and the room is gone.', [
      { label: 'Back to home', primary: true, action: goHome },
    ]);
  }

  send(msg) { this.net.send(msg); }

  leave() {
    this.ended = true;
    this.net.send({ t: 'leave' });
    setTimeout(() => this.net.close(), 200);
  }

  fatal(title, text) {
    if (this.ended) return;
    this.ended = true;
    this.net.close();
    UI.showMessage(title, text, [{ label: 'Back to home', primary: true, action: goHome }]);
  }
}

/* ═════════════════════════ App wiring ═════════════════════════ */

let host = null;
let guest = null;

function goHome() {
  window.location.href = window.location.pathname;
}

function inviteLink(code) {
  return `${window.location.origin}${window.location.pathname}?room=${code}`;
}

async function createRoom(name) {
  host = new HostRoom(name);
  host.onView = (view) => UI.render(view);
  try {
    await host.open();
  } catch (err) {
    host = null;
    throw new Error(err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error'
      ? "Couldn't reach the connection server. Check your internet and try again."
      : err.message);
  }
}

async function joinRoom(name, code) {
  guest = new GuestClient(code, name);
  guest.onView = (view) => UI.render(view);
  try {
    await guest.join();
  } catch (err) {
    guest = null;
    if (err.type === 'peer-unavailable') {
      throw new Error(`Room ${code} wasn't found. Check the code, or ask the host to create a new room.`);
    }
    if (err.type === 'timeout') {
      throw new Error("Couldn't connect to the room. If you're on mobile data, try Wi-Fi (some networks block direct connections).");
    }
    throw new Error(err.message || "Couldn't connect to the room.");
  }
  const url = new URL(window.location.href);
  url.searchParams.set('room', code);
  window.history.replaceState(null, '', url);
}

function leave() {
  const inGame = (host && host.phase === 'playing') || guest;
  if (host) {
    if (inGame && !window.confirm('Leave the room? This ends the game for everyone.')) return;
    host.close();
  } else if (guest) {
    if (!window.confirm('Leave the room?')) return;
    guest.leave();
  }
  setTimeout(goHome, 300);
}

UI.init({
  inviteLink,
  async onSubmitName({ mode, name, code }) {
    name = cleanName(name);
    if (!name) throw new Error('Please enter your name.');
    store.set('localStorage', 'tl-name', name);
    if (mode === 'create') {
      await createRoom(name);
    } else {
      code = normalizeCode(code);
      if (code.length !== CODE_LENGTH) throw new Error(`Room codes have ${CODE_LENGTH} characters.`);
      await joinRoom(name, code);
    }
  },
  onPlay(cards) {
    if (host) host.act(0, { type: 'play', cards });
    else if (guest) guest.send({ t: 'play', cards });
  },
  onPass() {
    if (host) host.act(0, { type: 'pass' });
    else if (guest) guest.send({ t: 'pass' });
  },
  onStart: () => host && host.startGame(),
  onNextGame: () => host && host.startGame(),
  onKick: (seat) => host && host.kick(seat),
  onSettings: (patch) => host && host.updateSettings(patch),
  onResetScores: () => host && host.resetScores(),
  onBackToLobby: () => host && host.backToLobby(),
  onLeave: leave,
});

window.addEventListener('beforeunload', (e) => {
  if (host) {
    if (host.phase === 'playing') {
      e.preventDefault();
      e.returnValue = ''; // browser shows "Leave site?"
    }
  }
});
// pagehide fires when the tab really goes away (also on mobile).
window.addEventListener('pagehide', (e) => {
  if (e.persisted) return;
  if (host) host.close();
  else if (guest && !guest.ended) guest.net.send({ t: 'leave' });
});

const roomParam = normalizeCode(new URLSearchParams(window.location.search).get('room'));
UI.start({
  savedName: store.get('localStorage', 'tl-name') || '',
  roomFromLink: roomParam.length === CODE_LENGTH ? roomParam : null,
});

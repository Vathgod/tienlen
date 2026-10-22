/**
 * network.js — PeerJS (WebRTC) transport between the host and guests.
 *
 * ════════════════════════════════════════════════════════════════════════
 *  MESSAGE PROTOCOL
 * ════════════════════════════════════════════════════════════════════════
 * The host's browser is the authoritative game server: it holds the full
 * game state, deals, validates every move and sends each guest a snapshot.
 * Guests only send actions and render what the host sends them.
 *
 * Every message is a JSON object with a `t` (type) field.
 *
 * Guest → Host
 *   { t: 'join', name, clientId }  Ask for a seat. `clientId` is a random id kept
 *                                  for the browser tab, so a refreshed or dropped
 *                                  tab gets its old seat back. During a game a
 *                                  disconnected seat can also be reclaimed by
 *                                  joining with the same name.
 *   { t: 'play', cards: [ids] }    Play these cards (ids 0..51, see game.js).
 *   { t: 'pass' }                  Pass for the rest of the round.
 *   { t: 'leave' }                 Leaving on purpose (Leave button / tab closed).
 *   { t: 'ping' }                  Heartbeat, every 3 s.
 *
 * Host → Guest
 *   { t: 'welcome', seat }         Join accepted; you sit in `seat` (0..3).
 *   { t: 'reject', reason }        Join refused. reason: 'full' | 'in-progress'
 *                                  | 'name-taken' | 'bad-name'. Connection closes.
 *   { t: 'view', view }            Full snapshot of the room for THIS guest
 *                                  (built by buildView in main.js): seats, settings,
 *                                  scores, phase, and during a game game.viewFor()
 *                                  — only this guest's own hand and the play on
 *                                  the table. Other players' hands, card counts and
 *                                  past plays are never sent. Sent after every change.
 *   { t: 'error', message }        Your last action was rejected ("Must beat …").
 *   { t: 'kicked' }                The host removed you from the lobby.
 *   { t: 'host-left' }             The host closed the room; the game is over.
 *   { t: 'ping' }                  Heartbeat, every 3 s.
 *
 * Either side treats 15 s without any message as a lost connection. A guest
 * that loses the host retries a few times (the host gives the seat back by
 * clientId); if the room no longer exists it shows "Host left, game ended".
 * ════════════════════════════════════════════════════════════════════════
 */
import { ICE_SERVERS, PEER_ID_PREFIX } from './config.js';

const HEARTBEAT_MS = 3000;
const TIMEOUT_MS = 15000;
const CONNECT_TIMEOUT_MS = 20000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
export const CODE_LENGTH = 6;

export function randomRoomCode() {
  const buf = new Uint32Array(CODE_LENGTH);
  crypto.getRandomValues(buf);
  return Array.from(buf, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
}

export const normalizeCode = (text) =>
  String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);

function makePeer(id) {
  if (typeof window.Peer === 'undefined') {
    throw new Error('Could not load the connection library (PeerJS). Check your internet connection and reload.');
  }
  return new window.Peer(id, { config: { iceServers: ICE_SERVERS }, debug: 1 });
}

const tagged = (message, type) => Object.assign(new Error(message), { type });

/* ───────────────────────── Host ───────────────────────── */

export class HostNetwork {
  /**
   * handlers.onMessage(connId, msg) — a guest sent something (pings excluded)
   * handlers.onDisconnect(connId)   — a guest's connection closed or timed out
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.peer = null;
    this.code = null;
    this.conns = new Map(); // connId → { conn, lastSeen }
    this.closed = false;
  }

  /** Register a room on the PeerJS server. Resolves with the room code. */
  async open() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomRoomCode();
      try {
        await this.#register(code);
        this.code = code;
        return code;
      } catch (err) {
        if (err.type !== 'unavailable-id') throw err;
      }
    }
    throw new Error('Could not create a room. Please try again.');
  }

  #register(code) {
    return new Promise((resolve, reject) => {
      const peer = makePeer(PEER_ID_PREFIX + code);
      const onError = (err) => { peer.destroy(); reject(err); };
      peer.once('error', onError);
      peer.once('open', () => {
        peer.off('error', onError);
        this.#attach(peer);
        resolve();
      });
    });
  }

  #attach(peer) {
    this.peer = peer;
    peer.on('connection', (conn) => this.#accept(conn));
    peer.on('error', (err) => console.warn('[host] peer error:', err.type, err));
    // Lost the PeerJS server (not the players): reconnect so new joins still work.
    peer.on('disconnected', () => {
      setTimeout(() => {
        if (!this.closed && !peer.destroyed && peer.disconnected) peer.reconnect();
      }, 1500);
    });
    this.heartbeat = setInterval(() => this.#tick(), HEARTBEAT_MS);
  }

  #accept(conn) {
    const id = conn.connectionId;
    const entry = { conn, lastSeen: Date.now() };
    this.conns.set(id, entry);
    conn.on('data', (msg) => {
      entry.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object' || msg.t === 'ping') return;
      if (this.conns.get(id) === entry) this.handlers.onMessage(id, msg);
    });
    conn.on('close', () => this.#drop(id, entry));
    conn.on('error', () => this.#drop(id, entry));
  }

  #drop(id, entry) {
    if (this.conns.get(id) !== entry) return;
    this.conns.delete(id);
    try { entry.conn.close(); } catch { /* already closed */ }
    this.handlers.onDisconnect(id);
  }

  #tick() {
    const now = Date.now();
    for (const [id, entry] of this.conns) {
      if (now - entry.lastSeen > TIMEOUT_MS) this.#drop(id, entry);
      else this.send(id, { t: 'ping' });
    }
  }

  send(connId, msg) {
    const entry = this.conns.get(connId);
    if (!entry || !entry.conn.open) return;
    try { entry.conn.send(msg); } catch (err) { console.warn('[host] send failed', err); }
  }

  /** Close one connection without firing onDisconnect, optionally sending a last message. */
  closeConn(connId, lastMsg) {
    const entry = this.conns.get(connId);
    if (!entry) return;
    this.conns.delete(connId);
    if (lastMsg) {
      try { entry.conn.send(lastMsg); } catch { /* ignore */ }
    }
    setTimeout(() => { try { entry.conn.close(); } catch { /* ignore */ } }, 500);
  }

  /** Close the room: tell everyone, then shut down. */
  destroy(lastMsg) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const { conn } of this.conns.values()) {
      try { if (lastMsg && conn.open) conn.send(lastMsg); } catch { /* ignore */ }
    }
    this.conns.clear();
    const peer = this.peer;
    setTimeout(() => peer && peer.destroy(), 300);
  }
}

/* ───────────────────────── Guest ───────────────────────── */

export class GuestNetwork {
  /**
   * handlers.onMessage(msg)   — the host sent something (pings excluded)
   * handlers.onLost(reason)   — the connection to the host closed or timed out
   */
  constructor(handlers) {
    this.handlers = handlers;
    this.peer = null;
    this.conn = null;
    this.closed = true;
  }

  /**
   * Connect to room `code`. Rejects with an Error whose `type` is
   * 'peer-unavailable' (no such room), 'timeout', or a PeerJS error type.
   */
  connect(code) {
    this.close();
    return new Promise((resolve, reject) => {
      let peer;
      try { peer = makePeer(); } catch (err) { reject(err); return; }
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        peer.destroy();
        reject(err);
      };
      const timer = setTimeout(
        () => fail(tagged('Timed out connecting to the room.', 'timeout')),
        CONNECT_TIMEOUT_MS,
      );
      peer.on('error', (err) => {
        if (!settled) fail(err);
        else console.warn('[guest] peer error:', err.type, err);
      });
      peer.on('open', () => {
        const conn = peer.connect(PEER_ID_PREFIX + code, { reliable: true, serialization: 'json' });
        conn.on('error', fail);
        conn.on('open', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.#attach(peer, conn);
          resolve();
        });
      });
    });
  }

  #attach(peer, conn) {
    this.peer = peer;
    this.conn = conn;
    this.closed = false;
    this.lastSeen = Date.now();
    conn.on('data', (msg) => {
      this.lastSeen = Date.now();
      if (!msg || typeof msg !== 'object' || msg.t === 'ping') return;
      if (this.conn === conn) this.handlers.onMessage(msg);
    });
    conn.on('close', () => { if (this.conn === conn) this.#lost('closed'); });
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastSeen > TIMEOUT_MS) this.#lost('timeout');
      else this.send({ t: 'ping' });
    }, HEARTBEAT_MS);
  }

  #lost(reason) {
    if (this.closed) return;
    this.close();
    this.handlers.onLost(reason);
  }

  send(msg) {
    if (!this.conn || !this.conn.open) return;
    try { this.conn.send(msg); } catch (err) { console.warn('[guest] send failed', err); }
  }

  close() {
    this.closed = true;
    clearInterval(this.heartbeat);
    const { conn, peer } = this;
    this.conn = null;
    this.peer = null;
    try { conn && conn.close(); } catch { /* ignore */ }
    try { peer && peer.destroy(); } catch { /* ignore */ }
  }
}

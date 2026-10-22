/**
 * config.js — connection settings.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ RELAY SERVER (TURN) — optional                                      │
 * │                                                                      │
 * │ Players connect directly to the host's browser. Some networks        │
 * │ (mostly mobile data, strict office/school Wi-Fi) block that. A relay │
 * │ server forwards the traffic so those players can still join.         │
 * │                                                                      │
 * │ Leave TURN_SERVERS empty to play without one. To add one:            │
 * │   1. Sign up for a free TURN service, e.g. https://www.metered.ca/   │
 * │      (Dashboard → TURN Server → copy username + credential).         │
 * │   2. Uncomment the lines below and paste your username/credential.   │
 * │   3. Upload this file to GitHub again.                               │
 * └──────────────────────────────────────────────────────────────────────┘
 */
export const TURN_SERVERS = [
  // { urls: 'turn:global.relay.metered.ca:80',                username: 'PASTE_USERNAME', credential: 'PASTE_CREDENTIAL' },
  // { urls: 'turn:global.relay.metered.ca:80?transport=tcp',  username: 'PASTE_USERNAME', credential: 'PASTE_CREDENTIAL' },
  // { urls: 'turn:global.relay.metered.ca:443',               username: 'PASTE_USERNAME', credential: 'PASTE_CREDENTIAL' },
  // { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'PASTE_USERNAME', credential: 'PASTE_CREDENTIAL' },
];

// Public STUN servers: let browsers discover their public address (free, no signup).
const STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const ICE_SERVERS = [...STUN_SERVERS, ...TURN_SERVERS];

// Rooms are registered on the free public PeerJS server as PEER_ID_PREFIX + room code.
// The prefix keeps our room codes from colliding with other apps using the same server.
export const PEER_ID_PREFIX = 'tienlen-mn-v1-';

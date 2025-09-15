import { writable, get } from 'svelte/store';
import { auth } from '$lib/stores/auth';
import { selectedChannelId, selectedGuildId } from '$lib/stores/appState';
import { browser } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';

type AnyRecord = Record<string, any>;

export const wsConnected = writable(false);
export const wsConnectionLost = writable(false);
export const wsEvent = writable<AnyRecord | null>(null);

let socket: WebSocket | null = null;
let hbTimer: any = null;
let heartbeatMs = 15000;
let lastT = 0;
let authed = false;
let lastEventId = 0; // track last received/sent event id
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shouldReconnect = true;

function nextT() {
  lastT += 1;
  return lastT;
}

function updateLastT(t?: number) {
  if (typeof t === 'number' && t > lastT) lastT = t;
  if (typeof t === 'number' && t > lastEventId) lastEventId = t;
}

function wsUrl(): string {
  const configured = (publicEnv?.PUBLIC_WS_URL as string | undefined) || undefined;
  if (configured) {
    if (configured.startsWith('ws://') || configured.startsWith('wss://')) return configured;
    if (!browser) return `ws://${configured}`;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${configured}`;
  }
  if (!browser) return 'ws://localhost/ws/subscribe';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname; // omit dev port
  return `${proto}//${host}/ws/subscribe`;
}

function send(obj: AnyRecord) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(obj));
  } catch {}
}

function sendRaw(raw: string) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(raw); } catch {}
}

// Preserve large int64 values as strings when parsing WS frames
function parseJSONPreserveLargeInts(data: string) {
  let out = '';
  let i = 0;
  let inStr = false;
  let esc = false;
  while (i < data.length) {
    const ch = data[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') { out += ch; inStr = true; i++; continue; }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let p = i - 1;
      while (p >= 0 && /\s/.test(data[p])) p--;
      const prev = p >= 0 ? data[p] : '';
      const okStart = p < 0 || prev === ':' || prev === '[' || prev === '{' || prev === ',';
      if (okStart) {
        const start = i;
        let end = i;
        let hasDot = false, hasExp = false;
        if (data[end] === '-') end++;
        while (end < data.length) {
          const c = data[end];
          if (c >= '0' && c <= '9') { end++; continue; }
          if (!hasDot && c === '.') { hasDot = true; end++; continue; }
          if (!hasExp && (c === 'e' || c === 'E')) {
            hasExp = true; end++;
            if (data[end] === '+' || data[end] === '-') end++;
            while (end < data.length && data[end] >= '0' && data[end] <= '9') end++;
            break;
          }
          break;
        }
        const numLiteral = data.slice(start, end);
        if (!hasDot && !hasExp) {
          const abs = numLiteral[0] === '-' ? numLiteral.slice(1) : numLiteral;
          if (abs.length >= 16) { out += '"' + numLiteral + '"'; i = end; continue; }
        }
      }
    }
    out += ch; i++;
  }
  return JSON.parse(out);
}

function startHeartbeat() {
  stopHeartbeat();
  if (heartbeatMs > 0) {
    hbTimer = setInterval(() => {
      // Heartbeat op=2 with last event id in data.e
      const t = nextT();
      const e = lastEventId || lastT || 0;
      const msg = `{"op":2,"data":{"e":${e}},"t":${t}}`;
      sendRaw(msg);
    }, heartbeatMs);
  }
}

function stopHeartbeat() {
  if (hbTimer) clearInterval(hbTimer);
  hbTimer = null;
}

export function disconnectWS() {
  shouldReconnect = false;
  stopHeartbeat();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try { socket.close(); } catch {}
  }
  socket = null;
  authed = false;
  wsConnected.set(false);
  wsConnectionLost.set(false);
}

export function connectWS() {
  if (!browser) return;
  shouldReconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const url = wsUrl();
  socket = new WebSocket(url);
  authed = false;

  socket.onopen = () => {
    wsConnected.set(true);
    wsConnectionLost.set(false);
    // Send auth (hello) immediately: op=1 with token and t
    const token = get(auth.token);
    if (token) {
      const t = nextT();
      const tok = JSON.stringify(token);
      sendRaw(`{"op":1,"d":{"token":${tok}},"t":${t}}`);
    }
  };

  socket.onmessage = (ev) => {
    let data: any;
    try { data = typeof ev.data === 'string' ? parseJSONPreserveLargeInts(ev.data) : ev.data; } catch { return; }

    // Handshake: server sends op=1 with d.heartbeat_interval (some servers may send root-level heartbeat_interval)
    if ((data?.op === 1 && typeof data?.d?.heartbeat_interval === 'number') || typeof data?.heartbeat_interval === 'number') {
      const interval = (data?.d?.heartbeat_interval ?? data?.heartbeat_interval) as number;
      heartbeatMs = interval;
      startHeartbeat();
      // Mark authed and subscribe to current selections
      authed = true;
      // After auth, (re)subscribe to current selections
      const gid = get(selectedGuildId);
      const ch = get(selectedChannelId);
      if (gid || ch) subscribeWS(gid ? [gid] : [], ch ?? undefined);
      return;
    }

    updateLastT(data?.t);
    wsEvent.set(data);

    // On message create event (op 0)
    if (data?.op === 0 && data?.d?.message) {
      // nothing here; consumers react via wsEvent
    }
  };

  socket.onclose = () => {
    wsConnected.set(false);
    stopHeartbeat();
    authed = false;
    socket = null;
    if (!shouldReconnect) return;
    wsConnectionLost.set(true);
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWS();
      }, 1000);
    }
  };

  socket.onerror = () => {
    // handled by onclose
  };
}

export function subscribeWS(guilds: (number | string)[] = [], channel?: number | string) {
  // Require that handshake and auth likely succeeded
  if (!authed) return;
  // IDs must be sent as raw int64 literals in JSON to avoid precision loss
  const ids = (guilds || []).map((g) => String(g).replace(/[^0-9]/g, '')).filter(Boolean);
  const ch = channel != null ? String(channel).replace(/[^0-9]/g, '') : '';
  const t = nextT();
  const dGuilds = `[${ids.join(',')}]`;
  const dChannel = ch ? `,"channel":${ch}` : '';
  const raw = `{"op":5,"d":{"guilds":${dGuilds}${dChannel}},"t":${t}}`;
  sendRaw(raw);
}

// React to auth & selection changes (browser only)
if (browser) {
  auth.isAuthenticated.subscribe((ok) => {
    if (ok) connectWS();
    else disconnectWS();
  });

  selectedChannelId.subscribe((ch) => {
    const gid = get(selectedGuildId);
    if (ch || gid) subscribeWS(gid ? [gid] : [], ch ?? undefined);
  });

  selectedGuildId.subscribe((gid) => {
    const ch = get(selectedChannelId);
    if (gid || ch) subscribeWS(gid ? [gid] : [], ch ?? undefined);
  });
}

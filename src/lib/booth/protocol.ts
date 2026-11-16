export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_QUEUE = 24;
export const CHUNK_BYTES = 8_000;
export const MAX_TRACK_MS = 20 * 60 * 1000;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type Track = {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  byteLength: number;
  mime: string;
  ownerId: string;
  ownerName: string;
};

export type BoothState = {
  hostId: string;
  revision: number;
  queue: Track[];
  paused: boolean;
  live: boolean;
  positionMs: number;
  at: number;
};

export type ClientMsg =
  | { t: "state"; state: BoothState }
  | { t: "add"; track: Track }
  | { t: "drop"; id: string }
  | { t: "need"; id: string }
  | { t: "ready"; id: string }
  | { t: "hello" }
  | { t: "chunk"; id: string; i: number; n: number; b64: string };

export function emptyState(): BoothState {
  return {
    hostId: "",
    revision: 0,
    queue: [],
    paused: true,
    live: false,
    positionMs: 0,
    at: 0,
  };
}

export function makeCode(length = 5): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function makeId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function elapsedMs(state: BoothState, now = Date.now()): number {
  if (!state.live || state.paused) return Math.max(0, state.positionMs);
  return Math.max(0, state.positionMs + (now - state.at));
}

export function addTrack(state: BoothState, track: Track, now: number): BoothState {
  if (state.queue.some((item) => item.id === track.id)) return state;
  if (state.queue.length >= MAX_QUEUE) return state;
  const starting = state.queue.length === 0;
  return {
    ...state,
    queue: [...state.queue, track],
    revision: state.revision + 1,
    live: starting ? false : state.live,
    paused: starting ? false : state.paused,
    positionMs: starting ? 0 : state.positionMs,
    at: starting ? now : state.at,
  };
}

export function dropTrack(state: BoothState, id: string, now: number): BoothState {
  const index = state.queue.findIndex((item) => item.id === id);
  if (index < 0) return state;
  const queue = state.queue.filter((item) => item.id !== id);
  if (index !== 0) return { ...state, queue, revision: state.revision + 1 };
  return {
    ...state,
    queue,
    revision: state.revision + 1,
    live: false,
    paused: false,
    positionMs: 0,
    at: now,
  };
}

export function skipTrack(state: BoothState, now: number): BoothState {
  if (!state.queue.length) return state;
  return dropTrack(state, state.queue[0].id, now);
}

export function setPaused(state: BoothState, paused: boolean, now: number): BoothState {
  if (!state.queue.length || !state.live || state.paused === paused) return state;
  return {
    ...state,
    paused,
    positionMs: elapsedMs(state, now),
    at: now,
    revision: state.revision + 1,
  };
}

export function seekTo(state: BoothState, positionMs: number, now: number): BoothState {
  if (!state.queue.length || !state.live) return state;
  const duration = state.queue[0].durationMs;
  const clamped = Math.max(0, Math.min(positionMs, Math.max(0, duration - 250)));
  return { ...state, positionMs: clamped, at: now, revision: state.revision + 1 };
}

export function goLive(state: BoothState, now: number): BoothState {
  if (!state.queue.length || state.live) return state;
  return {
    ...state,
    live: true,
    paused: false,
    positionMs: 0,
    at: now,
    revision: state.revision + 1,
  };
}

export function moveTrack(state: BoothState, id: string, dir: -1 | 1): BoothState {
  const index = state.queue.findIndex((item) => item.id === id);
  if (index <= 0) return state;
  const nextIndex = index + dir;
  if (nextIndex <= 0 || nextIndex >= state.queue.length) return state;
  const queue = state.queue.slice();
  const [item] = queue.splice(index, 1);
  queue.splice(nextIndex, 0, item);
  return { ...state, queue, revision: state.revision + 1 };
}

export function stripOwners(state: BoothState, gone: Set<string>, now: number): BoothState {
  if (!state.queue.some((track) => gone.has(track.ownerId))) return state;
  const removedCurrent = Boolean(state.queue[0] && gone.has(state.queue[0].ownerId));
  const queue = state.queue.filter((track) => !gone.has(track.ownerId));
  if (!removedCurrent) return { ...state, queue, revision: state.revision + 1 };
  return {
    ...state,
    queue,
    revision: state.revision + 1,
    live: false,
    paused: false,
    positionMs: 0,
    at: now,
  };
}

export function takeover(
  state: BoothState,
  selfId: string,
  alive: Set<string>,
  now: number,
): BoothState {
  const gone = new Set<string>();
  for (const track of state.queue) {
    if (!alive.has(track.ownerId)) gone.add(track.ownerId);
  }
  const stripped = stripOwners(state, gone, now);
  const revision = stripped.revision === state.revision ? state.revision + 1 : stripped.revision;
  return { ...stripped, hostId: selfId, revision };
}

export function finishIfElapsed(state: BoothState, now: number): BoothState | null {
  const current = state.queue[0];
  if (!current || !state.live || state.paused || !current.durationMs) return null;
  if (elapsedMs(state, now) < current.durationMs - 120) return null;
  return skipTrack(state, now);
}

export function validTrack(track: Track, from: string): boolean {
  if (track.ownerId !== from) return false;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(track.id)) return false;
  if (!track.title || track.title.length > 80) return false;
  if (!track.artist || track.artist.length > 80) return false;
  if (!track.ownerName || track.ownerName.length > 24) return false;
  if (track.byteLength <= 0 || track.byteLength > MAX_BYTES) return false;
  if (track.durationMs < 200 || track.durationMs > MAX_TRACK_MS) return false;
  if (!track.mime || track.mime.length > 80) return false;
  return true;
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object") return false;
  const track = value as Track;
  return (
    typeof track.id === "string" &&
    typeof track.title === "string" &&
    typeof track.artist === "string" &&
    typeof track.durationMs === "number" &&
    typeof track.byteLength === "number" &&
    typeof track.mime === "string" &&
    typeof track.ownerId === "string" &&
    typeof track.ownerName === "string"
  );
}

function isState(value: unknown): value is BoothState {
  if (!value || typeof value !== "object") return false;
  const state = value as BoothState;
  return (
    typeof state.hostId === "string" &&
    typeof state.revision === "number" &&
    Array.isArray(state.queue) &&
    state.queue.length <= MAX_QUEUE &&
    state.queue.every(isTrack) &&
    typeof state.paused === "boolean" &&
    typeof state.live === "boolean" &&
    typeof state.positionMs === "number" &&
    typeof state.at === "number"
  );
}

export function parseMsg(data: unknown): ClientMsg | null {
  if (!data || typeof data !== "object") return null;
  const msg = data as { t?: string };
  if (msg.t === "hello") return { t: "hello" };
  if (msg.t === "state" && isState((data as { state?: unknown }).state)) {
    return { t: "state", state: (data as { state: BoothState }).state };
  }
  if (msg.t === "add" && isTrack((data as { track?: unknown }).track)) {
    return { t: "add", track: (data as { track: Track }).track };
  }
  if (msg.t === "drop" && typeof (data as { id?: unknown }).id === "string") {
    return { t: "drop", id: (data as { id: string }).id };
  }
  if (msg.t === "need" && typeof (data as { id?: unknown }).id === "string") {
    return { t: "need", id: (data as { id: string }).id };
  }
  if (msg.t === "ready" && typeof (data as { id?: unknown }).id === "string") {
    return { t: "ready", id: (data as { id: string }).id };
  }
  if (msg.t === "chunk") {
    const chunk = data as { id?: unknown; i?: unknown; n?: unknown; b64?: unknown };
    if (typeof chunk.id !== "string") return null;
    if (typeof chunk.i !== "number" || typeof chunk.n !== "number") return null;
    if (typeof chunk.b64 !== "string") return null;
    if (chunk.n < 1 || chunk.n > 1200 || chunk.i < 0 || chunk.i >= chunk.n) return null;
    if (chunk.b64.length > 20_000) return null;
    return { t: "chunk", id: chunk.id, i: chunk.i, n: chunk.n, b64: chunk.b64 };
  }
  return null;
}

export function reconcile(
  local: BoothState,
  incoming: BoothState,
  from: string,
  selfId: string,
): BoothState {
  if (from !== incoming.hostId || !incoming.hostId) return local;
  if (local.hostId === selfId && incoming.hostId !== selfId && incoming.hostId > selfId) {
    return local;
  }
  if (incoming.revision < local.revision) return local;
  if (incoming.revision === local.revision) {
    return {
      ...local,
      hostId: incoming.hostId,
      paused: incoming.paused,
      live: incoming.live,
      positionMs: incoming.positionMs,
      at: incoming.at,
    };
  }
  return incoming;
}

export function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

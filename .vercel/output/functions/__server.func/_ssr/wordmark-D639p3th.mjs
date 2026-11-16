import { x as require_jsx_runtime } from "../_libs/@tanstack/react-router+[...].mjs";
import { t as clsx } from "../_libs/clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/wordmark-D639p3th.js
var import_jsx_runtime = require_jsx_runtime();
var CHUNK_BYTES = 8e3;
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function emptyState() {
	return {
		hostId: "",
		revision: 0,
		queue: [],
		paused: true,
		live: false,
		positionMs: 0,
		at: 0
	};
}
function makeCode(length = 5) {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => CODE_ALPHABET[b % 32]).join("");
}
function makeId() {
	const bytes = /* @__PURE__ */ new Uint8Array(9);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function elapsedMs(state, now = Date.now()) {
	if (!state.live || state.paused) return Math.max(0, state.positionMs);
	return Math.max(0, state.positionMs + (now - state.at));
}
function addTrack(state, track, now) {
	if (state.queue.some((item) => item.id === track.id)) return state;
	if (state.queue.length >= 24) return state;
	const starting = state.queue.length === 0;
	return {
		...state,
		queue: [...state.queue, track],
		revision: state.revision + 1,
		live: starting ? false : state.live,
		paused: starting ? false : state.paused,
		positionMs: starting ? 0 : state.positionMs,
		at: starting ? now : state.at
	};
}
function dropTrack(state, id, now) {
	const index = state.queue.findIndex((item) => item.id === id);
	if (index < 0) return state;
	const queue = state.queue.filter((item) => item.id !== id);
	if (index !== 0) return {
		...state,
		queue,
		revision: state.revision + 1
	};
	return {
		...state,
		queue,
		revision: state.revision + 1,
		live: false,
		paused: false,
		positionMs: 0,
		at: now
	};
}
function skipTrack(state, now) {
	if (!state.queue.length) return state;
	return dropTrack(state, state.queue[0].id, now);
}
function setPaused(state, paused, now) {
	if (!state.queue.length || !state.live || state.paused === paused) return state;
	return {
		...state,
		paused,
		positionMs: elapsedMs(state, now),
		at: now,
		revision: state.revision + 1
	};
}
function seekTo(state, positionMs, now) {
	if (!state.queue.length || !state.live) return state;
	const duration = state.queue[0].durationMs;
	const clamped = Math.max(0, Math.min(positionMs, Math.max(0, duration - 250)));
	return {
		...state,
		positionMs: clamped,
		at: now,
		revision: state.revision + 1
	};
}
function goLive(state, now) {
	if (!state.queue.length || state.live) return state;
	return {
		...state,
		live: true,
		paused: false,
		positionMs: 0,
		at: now,
		revision: state.revision + 1
	};
}
function moveTrack(state, id, dir) {
	const index = state.queue.findIndex((item) => item.id === id);
	if (index <= 0) return state;
	const nextIndex = index + dir;
	if (nextIndex <= 0 || nextIndex >= state.queue.length) return state;
	const queue = state.queue.slice();
	const [item] = queue.splice(index, 1);
	queue.splice(nextIndex, 0, item);
	return {
		...state,
		queue,
		revision: state.revision + 1
	};
}
function stripOwners(state, gone, now) {
	if (!state.queue.some((track) => gone.has(track.ownerId))) return state;
	const removedCurrent = Boolean(state.queue[0] && gone.has(state.queue[0].ownerId));
	const queue = state.queue.filter((track) => !gone.has(track.ownerId));
	if (!removedCurrent) return {
		...state,
		queue,
		revision: state.revision + 1
	};
	return {
		...state,
		queue,
		revision: state.revision + 1,
		live: false,
		paused: false,
		positionMs: 0,
		at: now
	};
}
function takeover(state, selfId, alive, now) {
	const gone = /* @__PURE__ */ new Set();
	for (const track of state.queue) if (!alive.has(track.ownerId)) gone.add(track.ownerId);
	const stripped = stripOwners(state, gone, now);
	const revision = stripped.revision === state.revision ? state.revision + 1 : stripped.revision;
	return {
		...stripped,
		hostId: selfId,
		revision
	};
}
function finishIfElapsed(state, now) {
	const current = state.queue[0];
	if (!current || !state.live || state.paused || !current.durationMs) return null;
	if (elapsedMs(state, now) < current.durationMs - 120) return null;
	return skipTrack(state, now);
}
function validTrack(track, from) {
	if (track.ownerId !== from) return false;
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(track.id)) return false;
	if (!track.title || track.title.length > 80) return false;
	if (!track.artist || track.artist.length > 80) return false;
	if (!track.ownerName || track.ownerName.length > 24) return false;
	if (track.byteLength <= 0 || track.byteLength > 8388608) return false;
	if (track.durationMs < 200 || track.durationMs > 12e5) return false;
	if (!track.mime || track.mime.length > 80) return false;
	return true;
}
function isTrack(value) {
	if (!value || typeof value !== "object") return false;
	const track = value;
	return typeof track.id === "string" && typeof track.title === "string" && typeof track.artist === "string" && typeof track.durationMs === "number" && typeof track.byteLength === "number" && typeof track.mime === "string" && typeof track.ownerId === "string" && typeof track.ownerName === "string";
}
function isState(value) {
	if (!value || typeof value !== "object") return false;
	const state = value;
	return typeof state.hostId === "string" && typeof state.revision === "number" && Array.isArray(state.queue) && state.queue.length <= 24 && state.queue.every(isTrack) && typeof state.paused === "boolean" && typeof state.live === "boolean" && typeof state.positionMs === "number" && typeof state.at === "number";
}
function parseMsg(data) {
	if (!data || typeof data !== "object") return null;
	const msg = data;
	if (msg.t === "hello") return { t: "hello" };
	if (msg.t === "state" && isState(data.state)) return {
		t: "state",
		state: data.state
	};
	if (msg.t === "add" && isTrack(data.track)) return {
		t: "add",
		track: data.track
	};
	if (msg.t === "drop" && typeof data.id === "string") return {
		t: "drop",
		id: data.id
	};
	if (msg.t === "need" && typeof data.id === "string") return {
		t: "need",
		id: data.id
	};
	if (msg.t === "ready" && typeof data.id === "string") return {
		t: "ready",
		id: data.id
	};
	if (msg.t === "chunk") {
		const chunk = data;
		if (typeof chunk.id !== "string") return null;
		if (typeof chunk.i !== "number" || typeof chunk.n !== "number") return null;
		if (typeof chunk.b64 !== "string") return null;
		if (chunk.n < 1 || chunk.n > 1200 || chunk.i < 0 || chunk.i >= chunk.n) return null;
		if (chunk.b64.length > 2e4) return null;
		return {
			t: "chunk",
			id: chunk.id,
			i: chunk.i,
			n: chunk.n,
			b64: chunk.b64
		};
	}
	return null;
}
function reconcile(local, incoming, from, selfId) {
	if (from !== incoming.hostId || !incoming.hostId) return local;
	if (local.hostId === selfId && incoming.hostId !== selfId && incoming.hostId > selfId) return local;
	if (incoming.revision < local.revision) return local;
	if (incoming.revision === local.revision) return {
		...local,
		hostId: incoming.hostId,
		paused: incoming.paused,
		live: incoming.live,
		positionMs: incoming.positionMs,
		at: incoming.at
	};
	return incoming;
}
function formatTime(ms) {
	if (!Number.isFinite(ms) || ms < 0) ms = 0;
	const total = Math.floor(ms / 1e3);
	return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
var tap = "transition-transform duration-150 ease-out active:not-disabled:scale-[0.96]";
function Wordmark({ className }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: cn("font-display text-xl font-medium tracking-tight text-cream", className),
		children: ["Side ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "text-brass italic",
			children: "A"
		})]
	});
}
//#endregion
export { validTrack as S, setPaused as _, dropTrack as a, takeover as b, finishIfElapsed as c, makeCode as d, makeId as f, seekTo as g, reconcile as h, cn as i, formatTime as l, parseMsg as m, Wordmark as n, elapsedMs as o, moveTrack as p, addTrack as r, emptyState as s, CHUNK_BYTES as t, goLive as u, skipTrack as v, tap as x, stripOwners as y };

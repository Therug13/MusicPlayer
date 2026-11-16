import { o as __toESM } from "./_runtime.mjs";
import { q as require_react, x as require_jsx_runtime, y as useNavigate } from "./_libs/@tanstack/react-router+[...].mjs";
import { a as Trash2, c as Plus, d as LoaderCircle, g as Check, h as ChevronDown, l as Play, m as ChevronUp, n as Volume2, o as SkipForward, p as Copy, t as VolumeX, u as Pause } from "./_libs/lucide-react.mjs";
import { n as Route } from "./_ssr/router-D91JI72W.mjs";
import { S as validTrack, _ as setPaused, a as dropTrack, b as takeover, c as finishIfElapsed, f as makeId, g as seekTo, h as reconcile, i as cn, l as formatTime, m as parseMsg, n as Wordmark, o as elapsedMs, p as moveTrack, r as addTrack, s as emptyState, t as CHUNK_BYTES, u as goLive, v as skipTrack, x as tap, y as stripOwners } from "./_ssr/wordmark-D639p3th.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/_code-BujajcTi.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
var FAST_POLL_MS = 400;
var IDLE_POLL_MS = 2e3;
var PING_INTERVAL_MS = 2e3;
var STALL_MS = 1e4;
var MAX_RECOVERY_ATTEMPTS = 3;
var SIGNAL_RETRY_DELAYS_MS = [250, 750];
function defaultIceServers() {
	return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
}
var P2PRoom = class {
	opts;
	peers = /* @__PURE__ */ new Map();
	/** Per-remote-peer signal delivery chains (order-preserving). */
	signalQueues = /* @__PURE__ */ new Map();
	cursor = 0;
	pollTimer = null;
	pingTimer = null;
	closed = false;
	everPolled = false;
	lastPeersFingerprint = "";
	constructor(opts) {
		this.opts = opts;
	}
	/**
	* The first poll IS the join: it registers this peer and returns the
	* roster. A failed first poll (cold DB, offline tab) must not strand the
	* room: the loop and timers start regardless and the next poll retries.
	*/
	async join() {
		try {
			await this.pollOnce();
		} catch {}
		if (this.closed) return;
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
		this.pingTimer = setInterval(() => {
			this.pingAll();
			this.watchdog();
		}, PING_INTERVAL_MS);
	}
	close() {
		this.closed = true;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		if (this.pingTimer) clearInterval(this.pingTimer);
		for (const slot of this.peers.values()) slot.pc.close();
		this.peers.clear();
		fetch("/api/rtc", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				op: "leave",
				room: this.opts.room,
				peer: this.opts.selfId
			}),
			keepalive: true
		}).catch(() => {});
	}
	/** Send on the unreliable game-state channel (drops stale packets). */
	broadcast(data) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		for (const slot of this.peers.values()) if (slot.state?.readyState === "open") slot.state.send(wire);
	}
	/** Send reliably (ordered) to one peer, or to all when peerId is omitted. */
	send(data, peerId) {
		const wire = JSON.stringify({
			t: "d",
			d: data
		});
		const targets = peerId ? [this.peers.get(peerId)] : [...this.peers.values()];
		for (const slot of targets) if (slot?.reliable?.readyState === "open") slot.reliable.send(wire);
	}
	peerList() {
		return [...this.peers.values()].map((s) => ({ ...s.info }));
	}
	schedulePoll(delay) {
		if (this.closed) return;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		this.pollTimer = setTimeout(() => void this.poll(), delay);
	}
	anyPairConnecting() {
		for (const s of this.peers.values()) {
			if (s.terminal) continue;
			if (s.info.connectionState !== "connected") return true;
		}
		return false;
	}
	async pollOnce() {
		const params = new URLSearchParams({
			room: this.opts.room,
			peer: this.opts.selfId,
			name: this.opts.name ?? "",
			since: String(this.cursor)
		});
		const res = await fetch(`/api/rtc?${params}`);
		if (this.closed) return;
		if (!res.ok) throw new Error(`signaling poll failed: ${res.status}`);
		const body = await res.json();
		if (this.closed) return;
		if (!this.everPolled) {
			this.everPolled = true;
			this.opts.onConnected?.();
		}
		this.reconcileRoster(body.peers);
		const roster = new Set(body.peers.map((p) => p.id));
		for (const sig of body.signals) {
			this.cursor = Math.max(this.cursor, sig.id);
			await this.onSignal(sig.from, sig.kind, sig.payload, roster);
			if (this.closed) return;
		}
	}
	async poll() {
		if (this.closed) return;
		try {
			await this.pollOnce();
		} catch {}
		this.schedulePoll(this.anyPairConnecting() ? FAST_POLL_MS : IDLE_POLL_MS);
	}
	reconcileRoster(peers) {
		const alive = new Set(peers.map((p) => p.id));
		for (const p of peers) {
			if (p.id === this.opts.selfId) continue;
			const existing = this.peers.get(p.id);
			if (existing) existing.info.name = p.name;
			else this.connectTo(p.id, p.name, this.opts.selfId > p.id);
		}
		for (const [id, slot] of this.peers) if (!alive.has(id)) {
			slot.pc.close();
			this.peers.delete(id);
		}
		this.emitPeers();
	}
	connectTo(peerId, name, initiator) {
		if (this.closed) return null;
		const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers ?? defaultIceServers() });
		const slot = {
			pc,
			makingOffer: false,
			ignoreOffer: false,
			pendingCandidates: [],
			lastProgressAt: Date.now(),
			recoveryAttempts: 0,
			info: {
				id: peerId,
				name,
				connectionState: pc.connectionState,
				candidateType: null,
				rttMs: null
			}
		};
		this.peers.set(peerId, slot);
		pc.onicecandidate = (e) => {
			if (e.candidate) this.sendSignal(peerId, "ice", e.candidate.toJSON());
		};
		pc.onconnectionstatechange = () => {
			slot.info.connectionState = pc.connectionState;
			if (pc.connectionState === "connecting" || pc.connectionState === "connected") slot.lastProgressAt = Date.now();
			if (pc.connectionState === "connected") {
				slot.recoveryAttempts = 0;
				slot.terminal = false;
				this.readCandidateType(slot);
			}
			this.emitPeers();
			if (pc.connectionState === "failed") pc.restartIce();
			if (pc.connectionState === "failed" || pc.connectionState === "disconnected") this.schedulePoll(FAST_POLL_MS);
		};
		pc.onnegotiationneeded = async () => {
			try {
				slot.makingOffer = true;
				await pc.setLocalDescription();
				await this.sendSignal(peerId, "offer", pc.localDescription.toJSON());
			} catch {} finally {
				slot.makingOffer = false;
			}
		};
		pc.ondatachannel = (e) => this.attachChannel(slot, e.channel);
		if (initiator) {
			this.attachChannel(slot, pc.createDataChannel("state", {
				ordered: false,
				maxRetransmits: 0
			}));
			this.attachChannel(slot, pc.createDataChannel("reliable", { ordered: true }));
		}
		return slot;
	}
	attachChannel(slot, channel) {
		if (channel.label === "state") slot.state = channel;
		else slot.reliable = channel;
		channel.onopen = () => {
			slot.lastProgressAt = Date.now();
		};
		channel.onmessage = (e) => {
			let msg;
			try {
				msg = JSON.parse(e.data);
			} catch {
				return;
			}
			if (msg.t === "ping") {
				if (slot.state?.readyState === "open") slot.state.send(JSON.stringify({ t: "pong" }));
			} else if (msg.t === "pong") {
				if (slot.pingSentAt) {
					slot.info.rttMs = Math.round(performance.now() - slot.pingSentAt);
					slot.pingSentAt = void 0;
					this.emitPeers();
				}
			} else this.opts.onMessage?.(slot.info.id, msg.d, channel.label === "state" ? "state" : "reliable");
		};
	}
	/** Apply buffered ICE candidates once a remote description is in place. */
	async flushPendingCandidates(slot) {
		while (slot.pendingCandidates.length > 0) {
			const candidate = slot.pendingCandidates.shift();
			try {
				await slot.pc.addIceCandidate(candidate);
			} catch (err) {
				if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
			}
			if (this.closed) return;
		}
	}
	async onSignal(from, kind, payload, roster) {
		if (this.closed) return;
		let slot = this.peers.get(from);
		if (!slot) {
			if (!roster.has(from)) return;
			const created = this.connectTo(from, "", false);
			if (!created) return;
			slot = created;
		}
		const polite = this.opts.selfId < from;
		try {
			if (kind === "offer" || kind === "answer") {
				const description = payload;
				const collision = kind === "offer" && (slot.makingOffer || slot.pc.signalingState !== "stable");
				slot.ignoreOffer = !polite && collision;
				if (slot.ignoreOffer) return;
				try {
					await slot.pc.setRemoteDescription(description);
				} catch (err) {
					if (kind !== "offer" || slot.recreatedForOffer) throw err;
					const attempts = slot.recoveryAttempts;
					const name = slot.info.name;
					slot.pc.close();
					this.peers.delete(from);
					const fresh = this.connectTo(from, name, false);
					if (!fresh) return;
					fresh.recoveryAttempts = attempts;
					fresh.recreatedForOffer = true;
					slot = fresh;
					await slot.pc.setRemoteDescription(description);
				}
				if (this.closed) return;
				await this.flushPendingCandidates(slot);
				if (this.closed) return;
				if (kind === "offer") {
					await slot.pc.setLocalDescription();
					if (this.closed) return;
					await this.sendSignal(from, "answer", slot.pc.localDescription.toJSON());
				}
			} else if (kind === "ice") {
				const candidate = payload;
				if (!slot.pc.remoteDescription) {
					slot.pendingCandidates.push(candidate);
					return;
				}
				try {
					await slot.pc.addIceCandidate(candidate);
				} catch (err) {
					if (!slot.ignoreOffer) console.warn("[p2p] addIceCandidate failed:", err);
				}
			}
		} catch {}
	}
	/**
	* Signals are serialized per remote peer (a candidate must never overtake
	* its SDP into the DB) and retried on failure with short backoff.
	*/
	sendSignal(to, kind, payload) {
		const next = (this.signalQueues.get(to) ?? Promise.resolve()).then(() => this.postSignal(to, kind, payload));
		this.signalQueues.set(to, next.catch(() => {}));
		return next;
	}
	async postSignal(to, kind, payload) {
		for (let attempt = 0;; attempt++) {
			if (this.closed) return;
			try {
				const res = await fetch("/api/rtc", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						op: "signal",
						room: this.opts.room,
						from: this.opts.selfId,
						to,
						kind,
						payload
					})
				});
				if (res.ok) return;
				throw new Error(`signal POST failed: ${res.status}`);
			} catch (err) {
				if (attempt >= SIGNAL_RETRY_DELAYS_MS.length) {
					console.warn(`[p2p] signal ${kind} to ${to} failed after retries`, err);
					return;
				}
				await new Promise((r) => setTimeout(r, SIGNAL_RETRY_DELAYS_MS[attempt]));
			}
		}
	}
	pingAll() {
		const wire = JSON.stringify({ t: "ping" });
		for (const slot of this.peers.values()) {
			if (slot.state?.readyState !== "open") continue;
			const stale = slot.pingSentAt !== void 0 && performance.now() - slot.pingSentAt > 2 * PING_INTERVAL_MS;
			if (slot.pingSentAt === void 0 || stale) {
				slot.pingSentAt = performance.now();
				slot.state.send(wire);
			}
		}
	}
	/**
	* Stuck-pair recovery, piggybacked on the ping interval. A pair that has
	* made no progress for STALL_MS gets rebuilt by the dialer with a FRESH
	* RTCPeerConnection (new DTLS identity — fixes the suspend/resume
	* fingerprint wedge). After MAX_RECOVERY_ATTEMPTS the pair is terminal:
	* visible to the app as its last connectionState, ignored by fast-poll.
	*/
	watchdog() {
		if (this.closed) return;
		const now = Date.now();
		for (const [peerId, slot] of this.peers) {
			const live = slot.pc.connectionState;
			if (live !== slot.info.connectionState) {
				slot.info.connectionState = live;
				if (live === "connecting" || live === "connected") slot.lastProgressAt = now;
				this.emitPeers();
			}
			if (slot.terminal || live === "connected") continue;
			if (now - slot.lastProgressAt <= STALL_MS) continue;
			if (slot.recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
				slot.terminal = true;
				this.emitPeers();
				continue;
			}
			slot.recoveryAttempts += 1;
			slot.lastProgressAt = now;
			if (this.opts.selfId > peerId) {
				const { name } = slot.info;
				const attempts = slot.recoveryAttempts;
				slot.pc.close();
				this.peers.delete(peerId);
				const fresh = this.connectTo(peerId, name, true);
				if (fresh) fresh.recoveryAttempts = attempts;
				this.schedulePoll(FAST_POLL_MS);
			}
		}
	}
	async readCandidateType(slot) {
		try {
			const stats = await slot.pc.getStats();
			let selected;
			stats.forEach((s) => {
				if (s.type === "candidate-pair" && s.nominated) selected = s;
			});
			const localId = selected?.localCandidateId;
			if (localId) {
				const local = stats.get(localId);
				slot.info.candidateType = local?.candidateType ?? null;
				this.emitPeers();
			}
		} catch {}
	}
	emitPeers() {
		const list = this.peerList();
		const fingerprint = JSON.stringify(list.map((p) => [
			p.id,
			p.name,
			p.connectionState,
			p.candidateType,
			p.rttMs
		]));
		if (fingerprint === this.lastPeersFingerprint) return;
		this.lastPeersFingerprint = fingerprint;
		this.opts.onPeersChanged?.(list);
	}
};
var AUDIO_EXT = /\.(mp3|mpeg|m4a|aac|wav|ogg|flac|webm|mp4)$/i;
function fromFilename(name) {
	const base = name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
	const parts = base.split(/\s+[-–—]\s+/);
	if (parts.length >= 2 && parts[0] && parts[1]) return {
		artist: parts[0],
		title: parts.slice(1).join(" - ")
	};
	return {
		title: base || "Untitled",
		artist: "Unknown artist"
	};
}
function syncsafe(view, offset) {
	return (view.getUint8(offset) & 127) << 21 | (view.getUint8(offset + 1) & 127) << 14 | (view.getUint8(offset + 2) & 127) << 7 | view.getUint8(offset + 3) & 127;
}
function trimNull(bytes) {
	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) end -= 1;
	return bytes.subarray(0, end);
}
function decodeFrame(bytes) {
	if (!bytes.length) return "";
	const encoding = bytes[0];
	const data = bytes.subarray(1);
	try {
		if (encoding === 0) return new TextDecoder("latin1").decode(trimNull(data)).trim();
		if (encoding === 1) return new TextDecoder("utf-16").decode(data).replace(/\0/g, "").trim();
		if (encoding === 2) return new TextDecoder("utf-16be").decode(trimNull(data)).trim();
		if (encoding === 3) return new TextDecoder("utf-8").decode(trimNull(data)).trim();
	} catch {
		return "";
	}
	return "";
}
/** Best-effort ID3v2.3 / 2.4 title and artist. Filename is the fallback. */
function readId3(bytes) {
	if (bytes.byteLength < 10) return {};
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint8(0) !== 73 || view.getUint8(1) !== 68 || view.getUint8(2) !== 51) return {};
	const version = view.getUint8(3);
	if (version !== 3 && version !== 4) return {};
	const flags = view.getUint8(5);
	if (flags & 128) return {};
	const tagSize = syncsafe(view, 6);
	let offset = 10;
	if (flags & 64) {
		const extra = version === 4 ? syncsafe(view, 10) : view.getUint32(10);
		offset += extra;
	}
	const end = Math.min(bytes.byteLength, 10 + tagSize);
	let title;
	let artist;
	while (offset + 10 <= end && (!title || !artist)) {
		const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
		if (id === "\0\0\0\0") break;
		const frameSize = version === 4 ? syncsafe(view, offset + 4) : view.getUint32(offset + 4);
		if (frameSize <= 0 || offset + 10 + frameSize > bytes.byteLength) break;
		const body = bytes.subarray(offset + 10, offset + 10 + frameSize);
		if (id === "TIT2" && !title) title = decodeFrame(body);
		if (id === "TPE1" && !artist) artist = decodeFrame(body);
		offset += 10 + frameSize;
	}
	return {
		title: title || void 0,
		artist: artist || void 0
	};
}
function measureDuration(blob) {
	return new Promise((resolve) => {
		const url = URL.createObjectURL(blob);
		const audio = document.createElement("audio");
		audio.preload = "metadata";
		const finish = (ms) => {
			URL.revokeObjectURL(url);
			audio.src = "";
			resolve(ms);
		};
		const timer = window.setTimeout(() => finish(0), 8e3);
		audio.onloadedmetadata = () => {
			window.clearTimeout(timer);
			const duration = audio.duration;
			finish(Number.isFinite(duration) ? duration * 1e3 : 0);
		};
		audio.onerror = () => {
			window.clearTimeout(timer);
			finish(0);
		};
		audio.src = url;
	});
}
function toBlob(bytes, type) {
	const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return new Blob([copy], { type });
}
async function readTrackFile(file, ownerId, ownerName) {
	if (!(file.type.startsWith("audio/") || AUDIO_EXT.test(file.name))) return { error: `${file.name} isn’t an audio file.` };
	if (file.size <= 0) return { error: `${file.name} is empty.` };
	if (file.size > 8388608) return { error: `${file.name} is over 8 MB. Shorter files stream straight from your browser.` };
	const bytes = new Uint8Array(await file.arrayBuffer());
	const tags = readId3(bytes);
	const fallback = fromFilename(file.name);
	const mime = file.type || "audio/mpeg";
	const durationMs = Math.round(await measureDuration(toBlob(bytes, mime)));
	if (!durationMs) return { error: `Couldn’t read ${file.name}.` };
	if (durationMs > 12e5) return { error: `${file.name} is longer than 20 minutes.` };
	return {
		bytes,
		track: {
			id: makeId(),
			title: (tags.title || fallback.title).slice(0, 80),
			artist: (tags.artist || fallback.artist).slice(0, 80),
			durationMs,
			byteLength: bytes.byteLength,
			mime,
			ownerId,
			ownerName: ownerName.slice(0, 24)
		}
	};
}
var STAGE_TTL_MS = 2e4;
function toB64(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}
function fromB64(value) {
	try {
		const binary = atob(value);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function useBooth(roomCode, name) {
	const selfId = (0, import_react.useRef)(makeId()).current;
	const [state, setState] = (0, import_react.useState)(emptyState);
	const [peers, setPeers] = (0, import_react.useState)([]);
	const [notice, setNotice] = (0, import_react.useState)(null);
	const [needsGesture, setNeedsGesture] = (0, import_react.useState)(false);
	const [importing, setImporting] = (0, import_react.useState)(false);
	const [signalOk, setSignalOk] = (0, import_react.useState)(false);
	const [localIds, setLocalIds] = (0, import_react.useState)([]);
	const [pull, setPull] = (0, import_react.useState)(null);
	const [audioEl, setAudioEl] = (0, import_react.useState)(null);
	const [volume, setVolumeState] = (0, import_react.useState)(.9);
	const stateRef = (0, import_react.useRef)(state);
	const peersRef = (0, import_react.useRef)([]);
	const roomRef = (0, import_react.useRef)(null);
	const bytesRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const urlsRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const stagedRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const pendingAdds = (0, import_react.useRef)([]);
	const readyRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const armRef = (0, import_react.useRef)(null);
	const incomingRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const sendingRef = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	const chainsRef = (0, import_react.useRef)(/* @__PURE__ */ new Map());
	const volumeRef = (0, import_react.useRef)(volume);
	const playPending = (0, import_react.useRef)(false);
	const lastNeed = (0, import_react.useRef)(0);
	const lastBeat = (0, import_react.useRef)(0);
	const greeted = (0, import_react.useRef)(/* @__PURE__ */ new Set());
	const noticeTimer = (0, import_react.useRef)(null);
	volumeRef.current = volume;
	stateRef.current = state;
	function say(message) {
		if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
		setNotice(message);
		if (message) noticeTimer.current = window.setTimeout(() => setNotice(null), 5200);
	}
	function publishLocalIds() {
		setLocalIds([...urlsRef.current.keys()]);
	}
	function remember(trackId, bytes, mime) {
		bytesRef.current.set(trackId, bytes);
		const previous = urlsRef.current.get(trackId);
		if (previous) URL.revokeObjectURL(previous);
		urlsRef.current.set(trackId, URL.createObjectURL(toBlob(bytes, mime)));
		stagedRef.current.set(trackId, Date.now());
		publishLocalIds();
	}
	function forget(trackId) {
		const url = urlsRef.current.get(trackId);
		if (url) URL.revokeObjectURL(url);
		urlsRef.current.delete(trackId);
		bytesRef.current.delete(trackId);
		stagedRef.current.delete(trackId);
		incomingRef.current.delete(trackId);
	}
	function publish(next) {
		const room = roomRef.current;
		if (!room || next.hostId !== selfId) return;
		const message = {
			t: "state",
			state: next
		};
		room.broadcast(message);
		for (const peer of peersRef.current) if (peer.connectionState === "connected") room.send(message, peer.id);
	}
	function commit(next) {
		const prev = stateRef.current;
		if (next === prev) return;
		if (prev.queue[0]?.id !== next.queue[0]?.id) armRef.current = next.queue[0] ? {
			id: next.queue[0].id,
			at: Date.now()
		} : null;
		stateRef.current = next;
		setState(next);
		publish(next);
	}
	function hostNow() {
		return stateRef.current.hostId === selfId;
	}
	function sendAdd(track) {
		const room = roomRef.current;
		const hostId = stateRef.current.hostId;
		if (!room || !hostId) {
			pendingAdds.current.push(track);
			return;
		}
		const message = {
			t: "add",
			track
		};
		room.broadcast(message);
		room.send(message, hostId);
	}
	function becomeHost(reason) {
		if (stateRef.current.hostId === selfId) return;
		const now = Date.now();
		let next = {
			...stateRef.current,
			hostId: selfId,
			revision: Math.max(1, stateRef.current.revision + (stateRef.current.hostId ? 1 : 0)),
			at: stateRef.current.at || now
		};
		if (!stateRef.current.hostId) next = {
			...next,
			revision: Math.max(next.revision, 1)
		};
		for (const track of pendingAdds.current) next = addTrack(next, track, now);
		pendingAdds.current = [];
		if (reason) say(reason);
		commit(next);
	}
	function flushPendingAdds() {
		if (!stateRef.current.hostId || stateRef.current.hostId === selfId) return;
		const queued = pendingAdds.current.splice(0);
		for (const track of queued) sendAdd(track);
	}
	function maybeGoLive() {
		if (!hostNow()) return;
		const current = stateRef.current.queue[0];
		if (!current || stateRef.current.live) return;
		if (armRef.current?.id !== current.id) armRef.current = {
			id: current.id,
			at: Date.now()
		};
		const have = urlsRef.current.has(current.id);
		const connected = peersRef.current.filter((peer) => peer.connectionState === "connected");
		const ready = readyRef.current.get(current.id);
		const allReady = have && connected.every((peer) => ready?.has(peer.id));
		const waited = Date.now() - (armRef.current?.at ?? Date.now());
		if (allReady) {
			commit(goLive(stateRef.current, Date.now()));
			return;
		}
		const budget = Math.min(45e3, 7e3 + Math.ceil(current.byteLength / CHUNK_BYTES) * 28);
		const incoming = incomingRef.current.get(current.id);
		if (waited < budget || incoming && incoming.parts.size > 0 && waited < budget + 12e3) return;
		if (have) commit(goLive(stateRef.current, Date.now()));
		else {
			say("Skipped a song — it never arrived from the person who added it.");
			commit(skipTrack(stateRef.current, Date.now()));
		}
	}
	function sweepLocals() {
		const now = Date.now();
		pendingAdds.current = pendingAdds.current.filter((track) => {
			const at = stagedRef.current.get(track.id) ?? now;
			return now - at <= STAGE_TTL_MS;
		});
		const keep = new Set(stateRef.current.queue.map((track) => track.id));
		for (const track of pendingAdds.current) keep.add(track.id);
		for (const id of incomingRef.current.keys()) keep.add(id);
		let changed = false;
		for (const [id, at] of stagedRef.current) {
			if (keep.has(id)) {
				if (stateRef.current.queue.some((track) => track.id === id)) stagedRef.current.delete(id);
				continue;
			}
			if (now - at > STAGE_TTL_MS) {
				forget(id);
				changed = true;
			}
		}
		if (changed) publishLocalIds();
	}
	function requestMissing() {
		const room = roomRef.current;
		if (!room) return;
		const now = Date.now();
		if (now - lastNeed.current < 1600) return;
		lastNeed.current = now;
		for (const track of stateRef.current.queue.slice(0, 2)) {
			if (track.ownerId === selfId || urlsRef.current.has(track.id)) continue;
			const owner = peersRef.current.find((peer) => peer.id === track.ownerId);
			if (!owner || owner.connectionState !== "connected") continue;
			room.send({
				t: "need",
				id: track.id
			}, track.ownerId);
		}
	}
	function enqueueFile(peerId, trackId) {
		const key = `${peerId}:${trackId}`;
		if (sendingRef.current.has(key)) return;
		sendingRef.current.add(key);
		const next = (chainsRef.current.get(peerId) ?? Promise.resolve()).then(() => sendFile(peerId, trackId)).finally(() => sendingRef.current.delete(key));
		chainsRef.current.set(peerId, next.catch(() => {}));
	}
	async function sendFile(peerId, trackId) {
		const bytes = bytesRef.current.get(trackId);
		const room = roomRef.current;
		if (!bytes || !room) return;
		const total = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));
		for (let index = 0; index < total; index += 1) {
			const stillQueued = stateRef.current.queue.some((track) => track.id === trackId);
			const peerUp = peersRef.current.some((peer) => peer.id === peerId && peer.connectionState === "connected");
			if (!stillQueued || !peerUp || !roomRef.current) return;
			const slice = bytes.subarray(index * CHUNK_BYTES, Math.min(bytes.byteLength, (index + 1) * CHUNK_BYTES));
			room.send({
				t: "chunk",
				id: trackId,
				i: index,
				n: total,
				b64: toB64(slice)
			}, peerId);
			if (index % 8 === 7) await sleep(12);
		}
	}
	function finishIncoming(trackId, mime) {
		const bucket = incomingRef.current.get(trackId);
		if (!bucket) return;
		let size = 0;
		for (let index = 0; index < bucket.n; index += 1) {
			const part = bucket.parts.get(index);
			if (!part) return;
			size += part.byteLength;
		}
		if (size <= 0 || size > 8388608) return;
		const merged = new Uint8Array(size);
		let offset = 0;
		for (let index = 0; index < bucket.n; index += 1) {
			const part = bucket.parts.get(index);
			merged.set(part, offset);
			offset += part.byteLength;
		}
		incomingRef.current.delete(trackId);
		remember(trackId, merged, mime);
		setPull(null);
		const room = roomRef.current;
		const hostId = stateRef.current.hostId;
		if (room && hostId && hostId !== selfId) {
			room.send({
				t: "ready",
				id: trackId
			}, hostId);
			room.broadcast({
				t: "ready",
				id: trackId
			});
		}
		if (hostNow()) {
			const set = readyRef.current.get(trackId) ?? /* @__PURE__ */ new Set();
			set.add(selfId);
			readyRef.current.set(trackId, set);
		}
	}
	function onMessage(from, data) {
		const msg = parseMsg(data);
		if (!msg || from === selfId) return;
		if (msg.t === "hello") {
			if (hostNow()) {
				const room = roomRef.current;
				room?.send({
					t: "state",
					state: stateRef.current
				}, from);
				room?.broadcast({
					t: "state",
					state: stateRef.current
				});
			}
			return;
		}
		if (msg.t === "state") {
			const next = reconcile(stateRef.current, msg.state, from, selfId);
			if (next === stateRef.current) return;
			if (stateRef.current.queue[0]?.id !== next.queue[0]?.id) armRef.current = next.queue[0] ? {
				id: next.queue[0].id,
				at: Date.now()
			} : null;
			stateRef.current = next;
			setState(next);
			if (next.hostId) flushPendingAdds();
			return;
		}
		if (msg.t === "add") {
			if (!hostNow() || !validTrack(msg.track, from)) return;
			if (stateRef.current.queue.length >= 24) return;
			commit(addTrack(stateRef.current, msg.track, Date.now()));
			return;
		}
		if (msg.t === "drop") {
			if (!hostNow()) return;
			const track = stateRef.current.queue.find((item) => item.id === msg.id);
			if (!track || from !== track.ownerId && from !== selfId) return;
			commit(dropTrack(stateRef.current, msg.id, Date.now()));
			return;
		}
		if (msg.t === "ready") {
			if (!hostNow()) return;
			const set = readyRef.current.get(msg.id) ?? /* @__PURE__ */ new Set();
			set.add(from);
			readyRef.current.set(msg.id, set);
			if (stateRef.current.queue[0]?.id === msg.id) maybeGoLive();
			return;
		}
		if (msg.t === "need") {
			const track = stateRef.current.queue.find((item) => item.id === msg.id);
			if (!track || track.ownerId !== selfId) return;
			enqueueFile(from, msg.id);
			return;
		}
		if (msg.t === "chunk") {
			const track = stateRef.current.queue.find((item) => item.id === msg.id);
			if (!track || track.ownerId !== from || urlsRef.current.has(msg.id)) return;
			let bucket = incomingRef.current.get(msg.id);
			if (!bucket || bucket.n !== msg.n) {
				bucket = {
					n: msg.n,
					parts: /* @__PURE__ */ new Map()
				};
				incomingRef.current.set(msg.id, bucket);
			}
			if (!bucket.parts.has(msg.i)) {
				const part = fromB64(msg.b64);
				if (!part) return;
				bucket.parts.set(msg.i, part);
			}
			if (msg.i % 8 === 0 || bucket.parts.size === bucket.n) setPull({
				id: msg.id,
				pct: bucket.parts.size / bucket.n
			});
			if (bucket.parts.size === bucket.n) finishIncoming(msg.id, track.mime);
		}
	}
	function onPeers(nextPeers) {
		peersRef.current = nextPeers;
		setPeers(nextPeers);
		const alive = /* @__PURE__ */ new Set([selfId, ...nextPeers.map((peer) => peer.id)]);
		const current = stateRef.current;
		if (!current.hostId) {
			if (nextPeers.length === 0) becomeHost();
			else roomRef.current?.broadcast({ t: "hello" });
		} else if (current.hostId !== selfId && !alive.has(current.hostId)) {
			if ([...alive].sort()[0] === selfId) {
				const pulled = current.queue.some((track) => !alive.has(track.ownerId));
				commit(takeover(current, selfId, alive, Date.now()));
				if (pulled) say("Someone left — their songs were pulled from the queue.");
			}
		} else if (current.hostId === selfId) {
			const gone = /* @__PURE__ */ new Set();
			for (const track of current.queue) if (!alive.has(track.ownerId)) gone.add(track.ownerId);
			if (gone.size) {
				say("Someone left — their songs were pulled from the queue.");
				commit(stripOwners(current, gone, Date.now()));
			}
			const room = roomRef.current;
			for (const peer of nextPeers) {
				if (peer.connectionState !== "connected" || greeted.current.has(peer.id)) continue;
				greeted.current.add(peer.id);
				room?.send({
					t: "state",
					state: stateRef.current
				}, peer.id);
			}
		}
		for (const id of [...greeted.current]) {
			const peer = nextPeers.find((item) => item.id === id);
			if (!peer || peer.connectionState !== "connected") greeted.current.delete(id);
		}
	}
	function syncAudio() {
		const audio = audioRef.current;
		if (!audio) return;
		const snapshot = stateRef.current;
		const track = snapshot.queue[0];
		const alive = /* @__PURE__ */ new Set([selfId, ...peersRef.current.map((peer) => peer.id)]);
		const ownerHere = Boolean(track && alive.has(track.ownerId));
		const url = track ? urlsRef.current.get(track.id) : void 0;
		if (!track || !ownerHere || !snapshot.live || !url) {
			if (!audio.paused) audio.pause();
			if ((!track || !ownerHere) && audio.dataset.track) {
				audio.removeAttribute("src");
				audio.load();
				audio.dataset.track = "";
			}
			return;
		}
		if (audio.dataset.track !== track.id) {
			audio.dataset.track = track.id;
			audio.src = url;
		}
		const target = elapsedMs(snapshot) / 1e3;
		if (audio.readyState >= 1 && Math.abs(audio.currentTime - target) > .45) try {
			const cap = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - .05) : target;
			audio.currentTime = Math.min(target, cap);
		} catch {}
		audio.volume = volumeRef.current;
		if (snapshot.paused) {
			if (!audio.paused) audio.pause();
			return;
		}
		if (audio.paused && !playPending.current) {
			playPending.current = true;
			audio.play().then(() => {
				playPending.current = false;
				setNeedsGesture(false);
			}).catch(() => {
				playPending.current = false;
				setNeedsGesture(true);
			});
		}
	}
	function heartbeat() {
		const room = roomRef.current;
		const snapshot = stateRef.current;
		if (!room || snapshot.hostId !== selfId) return;
		const now = Date.now();
		if (now - lastBeat.current < 900) return;
		lastBeat.current = now;
		const beat = snapshot.live && !snapshot.paused && snapshot.queue.length ? {
			...snapshot,
			positionMs: elapsedMs(snapshot, now),
			at: now
		} : snapshot;
		room.broadcast({
			t: "state",
			state: beat
		});
	}
	const audioRef = (0, import_react.useRef)(null);
	const onMessageRef = (0, import_react.useRef)(onMessage);
	const onPeersRef = (0, import_react.useRef)(onPeers);
	const syncRef = (0, import_react.useRef)(syncAudio);
	const tickRef = (0, import_react.useRef)(() => {
		if (hostNow()) {
			const finished = finishIfElapsed(stateRef.current, Date.now());
			if (finished) commit(finished);
			else maybeGoLive();
		}
		syncAudio();
		requestMissing();
		if (Date.now() % 1e3 < 260) sweepLocals();
	});
	onMessageRef.current = onMessage;
	onPeersRef.current = onPeers;
	syncRef.current = syncAudio;
	tickRef.current = () => {
		if (hostNow()) {
			const finished = finishIfElapsed(stateRef.current, Date.now());
			if (finished) commit(finished);
			else maybeGoLive();
		}
		syncRef.current();
		requestMissing();
		sweepLocals();
	};
	(0, import_react.useEffect)(() => {
		const saved = Number(localStorage.getItem("sidea:volume"));
		if (Number.isFinite(saved) && saved >= 0 && saved <= 1) setVolumeState(saved);
	}, []);
	(0, import_react.useEffect)(() => {
		const audio = new Audio();
		audio.preload = "auto";
		audioRef.current = audio;
		setAudioEl(audio);
		let dead = false;
		const room = new P2PRoom({
			room: roomCode,
			selfId,
			name,
			onConnected: () => {
				if (!dead) setSignalOk(true);
			},
			onPeersChanged: (next) => {
				if (!dead) onPeersRef.current(next);
			},
			onMessage: (from, data) => {
				if (!dead) onMessageRef.current(from, data);
			}
		});
		roomRef.current = room;
		room.join();
		const tick = window.setInterval(() => tickRef.current(), 250);
		const beat = window.setInterval(() => heartbeat(), 1e3);
		const hello = window.setInterval(() => {
			if (!dead && !stateRef.current.hostId && peersRef.current.length > 0) room.broadcast({ t: "hello" });
		}, 1500);
		const onHide = () => room.close();
		window.addEventListener("pagehide", onHide);
		return () => {
			dead = true;
			window.clearInterval(tick);
			window.clearInterval(beat);
			window.clearInterval(hello);
			window.removeEventListener("pagehide", onHide);
			room.close();
			if (roomRef.current === room) roomRef.current = null;
			audio.pause();
			audio.src = "";
			if (audioRef.current === audio) audioRef.current = null;
			setAudioEl(null);
			for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
			urlsRef.current.clear();
		};
	}, [
		roomCode,
		name,
		selfId
	]);
	(0, import_react.useEffect)(() => {
		if (audioRef.current) audioRef.current.volume = volume;
		localStorage.setItem("sidea:volume", String(volume));
	}, [volume]);
	async function addFiles(files) {
		if (!files.length || importing) return;
		setImporting(true);
		try {
			const errors = [];
			for (const file of files) {
				if (stateRef.current.queue.length + pendingAdds.current.length >= 24) {
					errors.push("The queue is full.");
					break;
				}
				const result = await readTrackFile(file, selfId, name);
				if ("error" in result) {
					errors.push(result.error);
					continue;
				}
				remember(result.track.id, result.bytes, result.track.mime);
				if (hostNow()) commit(addTrack(stateRef.current, result.track, Date.now()));
				else if (!stateRef.current.hostId) pendingAdds.current.push(result.track);
				else sendAdd(result.track);
			}
			if (errors.length) say(errors[0] ?? null);
		} finally {
			setImporting(false);
		}
	}
	function drop(id) {
		const track = stateRef.current.queue.find((item) => item.id === id);
		if (!track) return;
		if (!hostNow() && track.ownerId !== selfId) return;
		if (hostNow()) commit(dropTrack(stateRef.current, id, Date.now()));
		else {
			roomRef.current?.broadcast({
				t: "drop",
				id
			});
			if (stateRef.current.hostId) roomRef.current?.send({
				t: "drop",
				id
			}, stateRef.current.hostId);
		}
	}
	function skip() {
		if (!hostNow()) return;
		commit(skipTrack(stateRef.current, Date.now()));
	}
	function togglePause() {
		if (!hostNow()) return;
		const snapshot = stateRef.current;
		if (!snapshot.live || !snapshot.queue.length) return;
		commit(setPaused(snapshot, !snapshot.paused, Date.now()));
	}
	function seek(positionMs) {
		if (!hostNow()) return;
		commit(seekTo(stateRef.current, positionMs, Date.now()));
	}
	function move(id, dir) {
		if (!hostNow()) return;
		commit(moveTrack(stateRef.current, id, dir));
	}
	function unlock() {
		const audio = audioRef.current;
		if (!audio) return;
		audio.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
	}
	return {
		selfId,
		isHost: state.hostId === selfId && state.hostId !== "",
		state,
		peers,
		notice,
		needsGesture,
		importing,
		signalOk,
		localIds,
		pull,
		audioEl,
		volume,
		setVolume: setVolumeState,
		addFiles,
		drop,
		skip,
		togglePause,
		seek,
		move,
		unlock
	};
}
function Meter({ audio, active }) {
	const canvasRef = (0, import_react.useRef)(null);
	const activeRef = (0, import_react.useRef)(active);
	activeRef.current = active;
	(0, import_react.useEffect)(() => {
		const canvas = canvasRef.current;
		if (!canvas || !audio) return;
		const context = canvas.getContext("2d");
		if (!context) return;
		let audioContext;
		let source;
		let analyser;
		try {
			audioContext = new AudioContext();
			source = audioContext.createMediaElementSource(audio);
			analyser = audioContext.createAnalyser();
			analyser.fftSize = 64;
			source.connect(analyser);
			analyser.connect(audioContext.destination);
		} catch {
			return;
		}
		const bins = new Uint8Array(analyser.frequencyBinCount);
		let frame = 0;
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const draw = () => {
			if (!reduced) frame = window.requestAnimationFrame(draw);
			const width = canvas.clientWidth;
			const height = canvas.clientHeight;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
				canvas.width = Math.floor(width * dpr);
				canvas.height = Math.floor(height * dpr);
			}
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, width, height);
			if (activeRef.current && audioContext.state === "running") analyser.getByteFrequencyData(bins);
			else bins.fill(18);
			const count = 22;
			const gap = 4;
			const barWidth = Math.max(2, (width - 84) / count);
			for (let index = 0; index < count; index += 1) {
				const sample = bins[Math.floor(index / count * bins.length)] ?? 0;
				const level = Math.max(.06, sample / 255);
				const barHeight = Math.max(3, level * height);
				context.fillStyle = "#e4a54a";
				context.globalAlpha = .35 + level * .65;
				context.beginPath();
				context.roundRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight, 999);
				context.fill();
			}
			context.globalAlpha = 1;
		};
		const resume = () => {
			if (audioContext.state !== "running") audioContext.resume();
		};
		document.addEventListener("pointerdown", resume);
		draw();
		return () => {
			document.removeEventListener("pointerdown", resume);
			window.cancelAnimationFrame(frame);
			source.disconnect();
			audioContext.close();
		};
	}, [audio]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("canvas", {
		ref: canvasRef,
		className: "h-12 w-full",
		"aria-hidden": "true"
	});
}
function IconSwap({ on, onIcon: OnIcon, offIcon: OffIcon }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
		className: "relative grid size-5 place-items-center",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(OnIcon, {
			className: cn("col-start-1 row-start-1 size-5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]", on ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]"),
			"aria-hidden": "true"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(OffIcon, {
			className: cn("col-start-1 row-start-1 size-5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]", on ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none"),
			"aria-hidden": "true"
		})]
	});
}
function Progress({ stateRef, canSeek, onSeek }) {
	const fillRef = (0, import_react.useRef)(null);
	const labelRef = (0, import_react.useRef)(null);
	const totalRef = (0, import_react.useRef)(null);
	(0, import_react.useEffect)(() => {
		let frame = 0;
		const tick = () => {
			const snapshot = stateRef.current;
			const duration = snapshot?.queue[0]?.durationMs ?? 0;
			const ms = snapshot ? elapsedMs(snapshot) : 0;
			const ratio = duration > 0 ? Math.min(1, ms / duration) : 0;
			if (fillRef.current) fillRef.current.style.width = `${ratio * 100}%`;
			if (labelRef.current) labelRef.current.textContent = formatTime(ms);
			if (totalRef.current) totalRef.current.textContent = formatTime(duration);
			frame = window.requestAnimationFrame(tick);
		};
		frame = window.requestAnimationFrame(tick);
		return () => window.cancelAnimationFrame(frame);
	}, [stateRef]);
	function seekFrom(clientX, target) {
		const duration = stateRef.current?.queue[0]?.durationMs ?? 0;
		if (!canSeek || duration <= 0) return;
		const rect = target.getBoundingClientRect();
		onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration);
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "grid gap-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
			className: cn("flex h-11 items-center", canSeek ? "cursor-pointer" : "cursor-default"),
			onPointerDown: (event) => {
				if (!canSeek) return;
				event.currentTarget.setPointerCapture(event.pointerId);
				seekFrom(event.clientX, event.currentTarget);
			},
			onPointerMove: (event) => {
				if (!canSeek || event.buttons !== 1) return;
				seekFrom(event.clientX, event.currentTarget);
			},
			role: canSeek ? "slider" : "progressbar",
			"aria-valuemin": 0,
			"aria-valuemax": stateRef.current?.queue[0]?.durationMs ?? 0,
			"aria-label": "Song position",
			children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "relative h-1.5 w-full rounded-full bg-raised",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					ref: fillRef,
					className: "absolute inset-y-0 left-0 w-0 rounded-full bg-brass"
				})
			})
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "flex justify-between font-sans text-xs text-mist tabular-nums",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				ref: labelRef,
				children: "0:00"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				ref: totalRef,
				children: "0:00"
			})]
		})]
	});
}
function RoomView({ code, name }) {
	const navigate = useNavigate();
	const booth = useBooth(code, name);
	const fileRef = (0, import_react.useRef)(null);
	const [copied, setCopied] = (0, import_react.useState)(false);
	const [dragging, setDragging] = (0, import_react.useState)(false);
	const stateRef = (0, import_react.useRef)(booth.state);
	stateRef.current = booth.state;
	const current = booth.state.queue[0] ?? null;
	const playing = Boolean(current && booth.state.live && !booth.state.paused);
	const haveCurrent = current ? booth.localIds.includes(current.id) : false;
	const ownerHere = !current || current.ownerId === booth.selfId || booth.peers.some((peer) => peer.id === current.ownerId);
	const hostPeer = booth.peers.find((peer) => peer.id === booth.state.hostId);
	const hostName = booth.isHost ? "You" : hostPeer?.name || "the host";
	(0, import_react.useEffect)(() => {
		const onKey = (event) => {
			if (event.code !== "Space") return;
			const target = event.target;
			if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
			if (!booth.isHost) return;
			event.preventDefault();
			booth.togglePause();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [booth.isHost, booth.togglePause]);
	async function copyCode() {
		const link = window.location.href;
		try {
			await navigator.clipboard.writeText(link);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1800);
		} catch {
			setCopied(false);
		}
	}
	function onFiles(list) {
		if (!list) return;
		booth.addFiles([...list]);
	}
	const status = !booth.signalOk ? "Finding the room…" : !booth.state.hostId ? "Taking a seat…" : !current ? "The platter is empty." : !ownerHere ? "That song’s owner just left." : !haveCurrent && current.ownerId !== booth.selfId ? `Pulling this one from ${current.ownerName}…` : !booth.state.live ? "Holding until the room has it…" : booth.state.paused ? "Paused" : "On the platter";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
		className: "mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-4 pb-40 sm:px-6 sm:pt-6 sm:pb-10",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => void navigate({ to: "/" }),
					className: cn(tap, "rounded-lg"),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wordmark, {}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "sr-only",
						children: "Leave room"
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => void copyCode(),
					className: cn(tap, "flex h-11 items-center gap-2 rounded-full border border-line bg-panel pr-3 pl-4 text-sm text-cream"),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "font-display tracking-brand",
							children: code
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconSwap, {
							on: copied,
							onIcon: Check,
							offIcon: Copy
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "sr-only",
							children: copied ? "Link copied" : "Copy room link"
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-4 text-sm text-mist",
				children: booth.isHost ? "You’re hosting. Skip, pull, or reorder anything in the cue." : `${hostName} is hosting the cue. You can add songs and remove your own.`
			}),
			booth.notice ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-3 rounded-xl border border-line bg-raised px-3 py-2 text-sm text-cream",
				role: "status",
				children: booth.notice
			}) : null,
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-5 grid items-center gap-6 rounded-card border border-line bg-panel p-4 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "mx-auto w-44 sm:w-52",
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: cn("vinyl vinyl-spin grid aspect-square place-items-center", playing ? "" : "is-paused"),
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "vinyl-label grid size-[38%] place-items-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.2)]",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "size-2.5 rounded-full bg-ink" })
						})
					})
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "min-w-0",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "text-xs font-medium tracking-brand text-brass uppercase",
							children: status
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "mt-2 truncate font-display text-3xl font-medium text-cream sm:text-4xl",
							children: current ? current.title : "Nothing queued"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 truncate text-sm text-mist",
							children: current ? `${current.artist} · added by ${current.ownerId === booth.selfId ? "you" : current.ownerName}` : "Add an MP3 to start the room."
						}),
						booth.pull && current && booth.pull.id === current.id ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-2 text-xs text-mist tabular-nums",
							children: [
								"Receiving ",
								Math.round(booth.pull.pct * 100),
								"%"
							]
						}) : null,
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "mt-3",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Meter, {
								audio: booth.audioEl,
								active: playing
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Progress, {
							stateRef,
							canSeek: booth.isHost && Boolean(current && booth.state.live),
							onSeek: booth.seek
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur-md sm:static sm:z-auto sm:mt-4 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "mx-auto flex max-w-5xl items-center gap-2 sm:px-0",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: cn(tap, "grid size-12 place-items-center rounded-full bg-brass text-ink disabled:opacity-40"),
							disabled: !booth.isHost || !current || !booth.state.live,
							onClick: booth.togglePause,
							"aria-label": booth.state.paused ? "Play" : "Pause",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconSwap, {
								on: !playing,
								onIcon: Play,
								offIcon: Pause
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: cn(tap, "grid size-12 place-items-center rounded-full border border-line bg-panel text-cream disabled:opacity-40"),
							disabled: !booth.isHost || !current,
							onClick: booth.skip,
							"aria-label": "Skip",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SkipForward, {
								className: "size-5",
								"aria-hidden": "true"
							})
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "ml-auto flex items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								type: "button",
								className: cn(tap, "grid size-11 place-items-center rounded-full text-cream"),
								onClick: () => booth.setVolume(booth.volume === 0 ? .9 : 0),
								"aria-label": booth.volume === 0 ? "Unmute" : "Mute",
								children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(IconSwap, {
									on: booth.volume === 0,
									onIcon: VolumeX,
									offIcon: Volume2
								})
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "range",
								min: 0,
								max: 1,
								step: .01,
								value: booth.volume,
								"aria-label": "Your volume",
								onChange: (event) => booth.setVolume(Number(event.target.value)),
								className: "hidden w-28 sm:block"
							})]
						})
					]
				}), booth.needsGesture ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: cn(tap, "mx-auto mt-2 block text-sm text-brass"),
					onClick: booth.unlock,
					children: "Tap to listen"
				}) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: cn("rounded-card border border-dashed bg-panel/40 p-3 sm:p-4", dragging ? "border-brass" : "border-line"),
					onDragOver: (event) => {
						event.preventDefault();
						setDragging(true);
					},
					onDragLeave: () => setDragging(false),
					onDrop: (event) => {
						event.preventDefault();
						setDragging(false);
						onFiles(event.dataTransfer.files);
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex items-center justify-between gap-3 px-1",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "font-display text-xl text-cream",
								children: "The cue"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								type: "button",
								className: cn(tap, "flex h-11 items-center gap-2 rounded-full bg-cream px-4 text-sm font-medium text-ink disabled:opacity-50"),
								disabled: booth.importing,
								onClick: () => fileRef.current?.click(),
								children: [booth.importing ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(LoaderCircle, {
									className: "size-4 animate-spin",
									"aria-hidden": "true"
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Plus, {
									className: "size-4",
									"aria-hidden": "true"
								}), "Add songs"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								ref: fileRef,
								type: "file",
								accept: "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac",
								multiple: true,
								className: "sr-only",
								onChange: (event) => {
									onFiles(event.target.files);
									event.target.value = "";
								}
							})
						]
					}), booth.state.queue.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "px-1 py-10 text-center text-sm text-mist",
						children: "Drop MP3s here, or browse. They play from your browser — not from a server."
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", {
						className: "mt-3 grid gap-1",
						children: booth.state.queue.map((track, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(QueueRow, {
							track,
							index,
							isSelf: track.ownerId === booth.selfId,
							isHost: booth.isHost,
							canMoveUp: booth.isHost && index > 1,
							canMoveDown: booth.isHost && index > 0 && index < booth.state.queue.length - 1,
							onDrop: () => booth.drop(track.id),
							onMove: (dir) => booth.move(track.id, dir)
						}, track.id))
					})]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "rounded-card border border-line bg-panel p-4",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
							className: "font-display text-xl text-cream",
							children: "In the room"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("ul", {
							className: "mt-3 grid gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Person, {
								name: `${name} (you)`,
								detail: booth.isHost ? "Host" : booth.signalOk ? "Listening" : "Connecting",
								live: booth.signalOk
							}), booth.peers.map((peer) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Person, {
								name: peer.name || "Listener",
								detail: peer.id === booth.state.hostId ? "Host" : peer.connectionState === "connected" ? peer.rttMs != null ? `Linked · ${peer.rttMs} ms` : "Linked" : peer.connectionState === "failed" ? "Can’t link directly" : "Joining",
								live: peer.connectionState === "connected"
							}, peer.id))]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-4 text-xs leading-relaxed text-mist",
							children: "Songs stream from the person who added them. No cloud bucket. If their tab closes, that song stops for everyone. A direct link can fail on some networks — they’ll show as unable to link."
						})
					]
				})]
			})
		]
	});
}
function Person({ name, detail, live }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "flex items-center gap-3 rounded-xl bg-raised px-3 py-2",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: cn("size-2.5 shrink-0 rounded-full", live ? "bg-brass" : "bg-line"),
			"aria-hidden": "true"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "min-w-0",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block truncate text-sm text-cream",
				children: name
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "block text-xs text-mist",
				children: detail
			})]
		})]
	});
}
function QueueRow({ track, index, isSelf, isHost, canMoveUp, canMoveDown, onDrop, onMove }) {
	const canRemove = isHost || isSelf;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
		className: "flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-raised",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "flex w-8 shrink-0 items-center justify-center text-xs text-mist tabular-nums",
				children: index === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "size-1.5 rounded-full bg-brass",
					"aria-hidden": "true"
				}) : index
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "min-w-0 flex-1",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "block truncate text-sm text-cream",
					children: track.title
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
					className: "block truncate text-xs text-mist",
					children: [
						track.artist,
						" · ",
						isSelf ? "you" : track.ownerName
					]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "shrink-0 text-xs text-mist tabular-nums",
				children: formatTime(track.durationMs)
			}),
			isHost && index > 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "flex shrink-0",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: cn(tap, "grid size-11 place-items-center rounded-lg text-mist disabled:opacity-30"),
					disabled: !canMoveUp,
					onClick: () => onMove(-1),
					"aria-label": `Move ${track.title} up`,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronUp, { className: "size-4" })
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "button",
					className: cn(tap, "grid size-11 place-items-center rounded-lg text-mist disabled:opacity-30"),
					disabled: !canMoveDown,
					onClick: () => onMove(1),
					"aria-label": `Move ${track.title} down`,
					children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ChevronDown, { className: "size-4" })
				})]
			}) : null,
			canRemove ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				className: cn(tap, "grid size-11 shrink-0 place-items-center rounded-lg text-mist"),
				onClick: onDrop,
				"aria-label": `Remove ${track.title}`,
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trash2, { className: "size-4" })
			}) : null
		]
	});
}
function RoomPage() {
	const { code: raw } = Route.useParams();
	const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
	const navigate = useNavigate();
	const [name, setName] = (0, import_react.useState)(null);
	const [draft, setDraft] = (0, import_react.useState)("");
	const [ready, setReady] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		if (!/^[A-Z0-9]{4,6}$/.test(code)) {
			navigate({ to: "/" });
			return;
		}
		const saved = localStorage.getItem("sidea:name")?.trim();
		if (saved) setName(saved.slice(0, 24));
		setReady(true);
	}, [code, navigate]);
	if (!ready || !/^[A-Z0-9]{4,6}$/.test(code)) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "grid min-h-dvh place-items-center px-6 text-mist",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Opening the room…" })
	});
	if (!name) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "mx-auto grid min-h-dvh w-full max-w-md place-items-center px-5",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
			className: "w-full rounded-card border border-line bg-panel p-6",
			onSubmit: (event) => {
				event.preventDefault();
				const next = draft.trim().replace(/\s+/g, " ").slice(0, 24);
				if (!next) return;
				localStorage.setItem("sidea:name", next);
				setName(next);
			},
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wordmark, {}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h1", {
					className: "mt-4 font-display text-3xl text-cream",
					children: ["Room ", code]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-2 text-sm text-mist",
					children: "What should everyone call you?"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: draft,
					autoFocus: true,
					maxLength: 24,
					onChange: (event) => setDraft(event.target.value),
					className: "mt-4 h-12 w-full rounded-xl border border-line bg-ink px-3 text-base text-cream outline-none",
					placeholder: "Your name"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					type: "submit",
					className: cn(tap, "mt-3 h-12 w-full rounded-xl bg-brass text-sm font-medium text-ink"),
					children: "Take a seat"
				})
			]
		})
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(RoomView, {
		code,
		name
	}, `${code}:${name}`);
}
//#endregion
export { RoomPage as component };

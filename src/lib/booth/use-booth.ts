import { useEffect, useRef, useState } from "react";
import { P2PRoom, type PeerInfo } from "@/lib/multiplayer";
import { toBlob } from "./files";
import { readTrackFile } from "./files";
import {
  CHUNK_BYTES,
  MAX_QUEUE,
  addTrack,
  dropTrack,
  elapsedMs,
  emptyState,
  finishIfElapsed,
  goLive,
  makeId,
  moveTrack,
  parseMsg,
  reconcile,
  seekTo,
  setPaused,
  skipTrack,
  stripOwners,
  takeover,
  validTrack,
  type BoothState,
  type Track,
} from "./protocol";

const STAGE_TTL_MS = 20_000;

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function fromB64(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useBooth(roomCode: string, name: string) {
  const selfId = useRef(makeId()).current;
  const [state, setState] = useState<BoothState>(emptyState);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [importing, setImporting] = useState(false);
  const [signalOk, setSignalOk] = useState(false);
  const [localIds, setLocalIds] = useState<string[]>([]);
  const [pull, setPull] = useState<{ id: string; pct: number } | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [volume, setVolumeState] = useState(0.9);

  const stateRef = useRef(state);
  const peersRef = useRef<PeerInfo[]>([]);
  const roomRef = useRef<P2PRoom | null>(null);
  const bytesRef = useRef(new Map<string, Uint8Array>());
  const urlsRef = useRef(new Map<string, string>());
  const stagedRef = useRef(new Map<string, number>());
  const pendingAdds = useRef<Track[]>([]);
  const readyRef = useRef(new Map<string, Set<string>>());
  const armRef = useRef<{ id: string; at: number } | null>(null);
  const incomingRef = useRef(new Map<string, { n: number; parts: Map<number, Uint8Array> }>());
  const sendingRef = useRef(new Set<string>());
  const chainsRef = useRef(new Map<string, Promise<void>>());
  const volumeRef = useRef(volume);
  const playPending = useRef(false);
  const lastNeed = useRef(0);
  const lastBeat = useRef(0);
  const greeted = useRef(new Set<string>());
  const noticeTimer = useRef<number | null>(null);

  volumeRef.current = volume;
  stateRef.current = state;

  function say(message: string | null) {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(message);
    if (message) {
      noticeTimer.current = window.setTimeout(() => setNotice(null), 5200);
    }
  }

  function publishLocalIds() {
    setLocalIds([...urlsRef.current.keys()]);
  }

  function remember(trackId: string, bytes: Uint8Array, mime: string) {
    bytesRef.current.set(trackId, bytes);
    const previous = urlsRef.current.get(trackId);
    if (previous) URL.revokeObjectURL(previous);
    urlsRef.current.set(trackId, URL.createObjectURL(toBlob(bytes, mime)));
    stagedRef.current.set(trackId, Date.now());
    publishLocalIds();
  }

  function forget(trackId: string) {
    const url = urlsRef.current.get(trackId);
    if (url) URL.revokeObjectURL(url);
    urlsRef.current.delete(trackId);
    bytesRef.current.delete(trackId);
    stagedRef.current.delete(trackId);
    incomingRef.current.delete(trackId);
  }

  function publish(next: BoothState) {
    const room = roomRef.current;
    if (!room || next.hostId !== selfId) return;
    const message = { t: "state" as const, state: next };
    room.broadcast(message);
    for (const peer of peersRef.current) {
      if (peer.connectionState === "connected") room.send(message, peer.id);
    }
  }

  function commit(next: BoothState) {
    const prev = stateRef.current;
    if (next === prev) return;
    if (prev.queue[0]?.id !== next.queue[0]?.id) {
      armRef.current = next.queue[0] ? { id: next.queue[0].id, at: Date.now() } : null;
    }
    stateRef.current = next;
    setState(next);
    publish(next);
  }

  function hostNow() {
    return stateRef.current.hostId === selfId;
  }

  function sendAdd(track: Track) {
    const room = roomRef.current;
    const hostId = stateRef.current.hostId;
    if (!room || !hostId) {
      pendingAdds.current.push(track);
      return;
    }
    const message = { t: "add" as const, track };
    room.broadcast(message);
    room.send(message, hostId);
  }

  function becomeHost(reason?: string) {
    if (stateRef.current.hostId === selfId) return;
    const now = Date.now();
    let next: BoothState = {
      ...stateRef.current,
      hostId: selfId,
      revision: Math.max(1, stateRef.current.revision + (stateRef.current.hostId ? 1 : 0)),
      at: stateRef.current.at || now,
    };
    if (!stateRef.current.hostId) next = { ...next, revision: Math.max(next.revision, 1) };
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
    if (armRef.current?.id !== current.id) {
      armRef.current = { id: current.id, at: Date.now() };
    }
    const have = urlsRef.current.has(current.id);
    const connected = peersRef.current.filter((peer) => peer.connectionState === "connected");
    const ready = readyRef.current.get(current.id);
    const allReady = have && connected.every((peer) => ready?.has(peer.id));
    const waited = Date.now() - (armRef.current?.at ?? Date.now());
    if (allReady) {
      commit(goLive(stateRef.current, Date.now()));
      return;
    }
    const budget = Math.min(
      45_000,
      7000 + Math.ceil(current.byteLength / CHUNK_BYTES) * 28,
    );
    const incoming = incomingRef.current.get(current.id);
    if (waited < budget || (incoming && incoming.parts.size > 0 && waited < budget + 12_000)) return;
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
      room.send({ t: "need", id: track.id }, track.ownerId);
    }
  }

  function enqueueFile(peerId: string, trackId: string) {
    const key = `${peerId}:${trackId}`;
    if (sendingRef.current.has(key)) return;
    sendingRef.current.add(key);
    const prev = chainsRef.current.get(peerId) ?? Promise.resolve();
    const next = prev
      .then(() => sendFile(peerId, trackId))
      .finally(() => sendingRef.current.delete(key));
    chainsRef.current.set(
      peerId,
      next.catch(() => {}),
    );
  }

  async function sendFile(peerId: string, trackId: string) {
    const bytes = bytesRef.current.get(trackId);
    const room = roomRef.current;
    if (!bytes || !room) return;
    const total = Math.max(1, Math.ceil(bytes.byteLength / CHUNK_BYTES));
    for (let index = 0; index < total; index += 1) {
      const stillQueued = stateRef.current.queue.some((track) => track.id === trackId);
      const peerUp = peersRef.current.some(
        (peer) => peer.id === peerId && peer.connectionState === "connected",
      );
      if (!stillQueued || !peerUp || !roomRef.current) return;
      const slice = bytes.subarray(
        index * CHUNK_BYTES,
        Math.min(bytes.byteLength, (index + 1) * CHUNK_BYTES),
      );
      room.send({ t: "chunk", id: trackId, i: index, n: total, b64: toB64(slice) }, peerId);
      if (index % 8 === 7) await sleep(12);
    }
  }

  function finishIncoming(trackId: string, mime: string) {
    const bucket = incomingRef.current.get(trackId);
    if (!bucket) return;
    let size = 0;
    for (let index = 0; index < bucket.n; index += 1) {
      const part = bucket.parts.get(index);
      if (!part) return;
      size += part.byteLength;
    }
    if (size <= 0 || size > 8 * 1024 * 1024) return;
    const merged = new Uint8Array(size);
    let offset = 0;
    for (let index = 0; index < bucket.n; index += 1) {
      const part = bucket.parts.get(index)!;
      merged.set(part, offset);
      offset += part.byteLength;
    }
    incomingRef.current.delete(trackId);
    remember(trackId, merged, mime);
    setPull(null);
    const room = roomRef.current;
    const hostId = stateRef.current.hostId;
    if (room && hostId && hostId !== selfId) {
      room.send({ t: "ready", id: trackId }, hostId);
      room.broadcast({ t: "ready", id: trackId });
    }
    if (hostNow()) {
      const set = readyRef.current.get(trackId) ?? new Set<string>();
      set.add(selfId);
      readyRef.current.set(trackId, set);
    }
  }

  function onMessage(from: string, data: unknown) {
    const msg = parseMsg(data);
    if (!msg || from === selfId) return;
    if (msg.t === "hello") {
      if (hostNow()) {
        const room = roomRef.current;
        room?.send({ t: "state", state: stateRef.current }, from);
        room?.broadcast({ t: "state", state: stateRef.current });
      }
      return;
    }
    if (msg.t === "state") {
      const next = reconcile(stateRef.current, msg.state, from, selfId);
      if (next === stateRef.current) return;
      const trackChanged = stateRef.current.queue[0]?.id !== next.queue[0]?.id;
      if (trackChanged) {
        armRef.current = next.queue[0] ? { id: next.queue[0].id, at: Date.now() } : null;
      }
      stateRef.current = next;
      setState(next);
      if (next.hostId) flushPendingAdds();
      return;
    }
    if (msg.t === "add") {
      if (!hostNow() || !validTrack(msg.track, from)) return;
      if (stateRef.current.queue.length >= MAX_QUEUE) return;
      commit(addTrack(stateRef.current, msg.track, Date.now()));
      return;
    }
    if (msg.t === "drop") {
      if (!hostNow()) return;
      const track = stateRef.current.queue.find((item) => item.id === msg.id);
      if (!track || (from !== track.ownerId && from !== selfId)) return;
      commit(dropTrack(stateRef.current, msg.id, Date.now()));
      return;
    }
    if (msg.t === "ready") {
      if (!hostNow()) return;
      const set = readyRef.current.get(msg.id) ?? new Set<string>();
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
        bucket = { n: msg.n, parts: new Map() };
        incomingRef.current.set(msg.id, bucket);
      }
      if (!bucket.parts.has(msg.i)) {
        const part = fromB64(msg.b64);
        if (!part) return;
        bucket.parts.set(msg.i, part);
      }
      if (msg.i % 8 === 0 || bucket.parts.size === bucket.n) {
        setPull({ id: msg.id, pct: bucket.parts.size / bucket.n });
      }
      if (bucket.parts.size === bucket.n) finishIncoming(msg.id, track.mime);
    }
  }

  function onPeers(nextPeers: PeerInfo[]) {
    peersRef.current = nextPeers;
    setPeers(nextPeers);
    const alive = new Set([selfId, ...nextPeers.map((peer) => peer.id)]);
    const current = stateRef.current;

    if (!current.hostId) {
      if (nextPeers.length === 0) becomeHost();
      else {
        const room = roomRef.current;
        room?.broadcast({ t: "hello" });
      }
    } else if (current.hostId !== selfId && !alive.has(current.hostId)) {
      const smallest = [...alive].sort()[0];
      if (smallest === selfId) {
        const pulled = current.queue.some((track) => !alive.has(track.ownerId));
        commit(takeover(current, selfId, alive, Date.now()));
        if (pulled) say("Someone left — their songs were pulled from the queue.");
      }
    } else if (current.hostId === selfId) {
      const gone = new Set<string>();
      for (const track of current.queue) {
        if (!alive.has(track.ownerId)) gone.add(track.ownerId);
      }
      if (gone.size) {
        say("Someone left — their songs were pulled from the queue.");
        commit(stripOwners(current, gone, Date.now()));
      }
      const room = roomRef.current;
      for (const peer of nextPeers) {
        if (peer.connectionState !== "connected" || greeted.current.has(peer.id)) continue;
        greeted.current.add(peer.id);
        room?.send({ t: "state", state: stateRef.current }, peer.id);
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
    const alive = new Set([selfId, ...peersRef.current.map((peer) => peer.id)]);
    const ownerHere = Boolean(track && alive.has(track.ownerId));
    const url = track ? urlsRef.current.get(track.id) : undefined;
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
    const target = elapsedMs(snapshot) / 1000;
    if (audio.readyState >= 1 && Math.abs(audio.currentTime - target) > 0.45) {
      try {
        const cap = Number.isFinite(audio.duration) ? Math.max(0, audio.duration - 0.05) : target;
        audio.currentTime = Math.min(target, cap);
      } catch {
        // Metadata may not be ready yet.
      }
    }
    audio.volume = volumeRef.current;
    if (snapshot.paused) {
      if (!audio.paused) audio.pause();
      return;
    }
    if (audio.paused && !playPending.current) {
      playPending.current = true;
      void audio
        .play()
        .then(() => {
          playPending.current = false;
          setNeedsGesture(false);
        })
        .catch(() => {
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
    const beat =
      snapshot.live && !snapshot.paused && snapshot.queue.length
        ? { ...snapshot, positionMs: elapsedMs(snapshot, now), at: now }
        : snapshot;
    room.broadcast({ t: "state", state: beat });
  }

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onMessageRef = useRef(onMessage);
  const onPeersRef = useRef(onPeers);
  const syncRef = useRef(syncAudio);
  const tickRef = useRef(() => {
    if (hostNow()) {
      const finished = finishIfElapsed(stateRef.current, Date.now());
      if (finished) commit(finished);
      else maybeGoLive();
    }
    syncAudio();
    requestMissing();
    if (Date.now() % 1000 < 260) sweepLocals();
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

  useEffect(() => {
    const saved = Number(localStorage.getItem("sidea:volume"));
    if (Number.isFinite(saved) && saved >= 0 && saved <= 1) setVolumeState(saved);
  }, []);

  useEffect(() => {
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
      },
    });
    roomRef.current = room;
    void room.join();
    const tick = window.setInterval(() => tickRef.current(), 250);
    const beat = window.setInterval(() => heartbeat(), 1000);
    const hello = window.setInterval(() => {
      if (!dead && !stateRef.current.hostId && peersRef.current.length > 0) {
        room.broadcast({ t: "hello" });
      }
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
    // Room membership is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, name, selfId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    localStorage.setItem("sidea:volume", String(volume));
  }, [volume]);

  async function addFiles(files: File[]) {
    if (!files.length || importing) return;
    setImporting(true);
    try {
      const errors: string[] = [];
      for (const file of files) {
        if (stateRef.current.queue.length + pendingAdds.current.length >= MAX_QUEUE) {
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

  function drop(id: string) {
    const track = stateRef.current.queue.find((item) => item.id === id);
    if (!track) return;
    if (!hostNow() && track.ownerId !== selfId) return;
    if (hostNow()) commit(dropTrack(stateRef.current, id, Date.now()));
    else {
      roomRef.current?.broadcast({ t: "drop", id });
      if (stateRef.current.hostId) roomRef.current?.send({ t: "drop", id }, stateRef.current.hostId);
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

  function seek(positionMs: number) {
    if (!hostNow()) return;
    commit(seekTo(stateRef.current, positionMs, Date.now()));
  }

  function move(id: string, dir: -1 | 1) {
    if (!hostNow()) return;
    commit(moveTrack(stateRef.current, id, dir));
  }

  function unlock() {
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().then(() => setNeedsGesture(false)).catch(() => setNeedsGesture(true));
  }

  const isHost = state.hostId === selfId && state.hostId !== "";

  return {
    selfId,
    isHost,
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
    unlock,
  };
}

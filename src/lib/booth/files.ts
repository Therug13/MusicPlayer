import { MAX_BYTES, MAX_TRACK_MS, makeId, type Track } from "./protocol";

const AUDIO_EXT = /\.(mp3|mpeg|m4a|aac|wav|ogg|flac|webm|mp4)$/i;

export function fromFilename(name: string): { title: string; artist: string } {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .trim();
  const parts = base.split(/\s+[-–—]\s+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return { artist: parts[0], title: parts.slice(1).join(" - ") };
  }
  return { title: base || "Untitled", artist: "Unknown artist" };
}

function syncsafe(view: DataView, offset: number): number {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  );
}

function trimNull(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end -= 1;
  return bytes.subarray(0, end);
}

function decodeFrame(bytes: Uint8Array): string {
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
export function readId3(bytes: Uint8Array): { title?: string; artist?: string } {
  if (bytes.byteLength < 10) return {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) {
    return {};
  }
  const version = view.getUint8(3);
  if (version !== 3 && version !== 4) return {};
  const flags = view.getUint8(5);
  if (flags & 0x80) return {};
  const tagSize = syncsafe(view, 6);
  let offset = 10;
  if (flags & 0x40) {
    const extra = version === 4 ? syncsafe(view, 10) : view.getUint32(10);
    offset += extra;
  }
  const end = Math.min(bytes.byteLength, 10 + tagSize);
  let title: string | undefined;
  let artist: string | undefined;
  while (offset + 10 <= end && (!title || !artist)) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
    if (id === "\0\0\0\0") break;
    const frameSize = version === 4 ? syncsafe(view, offset + 4) : view.getUint32(offset + 4);
    if (frameSize <= 0 || offset + 10 + frameSize > bytes.byteLength) break;
    const body = bytes.subarray(offset + 10, offset + 10 + frameSize);
    if (id === "TIT2" && !title) title = decodeFrame(body);
    if (id === "TPE1" && !artist) artist = decodeFrame(body);
    offset += 10 + frameSize;
  }
  return {
    title: title || undefined,
    artist: artist || undefined,
  };
}

function measureDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    const finish = (ms: number) => {
      URL.revokeObjectURL(url);
      audio.src = "";
      resolve(ms);
    };
    const timer = window.setTimeout(() => finish(0), 8000);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      const duration = audio.duration;
      finish(Number.isFinite(duration) ? duration * 1000 : 0);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(0);
    };
    audio.src = url;
  });
}

export function toBlob(bytes: Uint8Array, type: string): Blob {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([copy], { type });
}

export async function readTrackFile(
  file: File,
  ownerId: string,
  ownerName: string,
): Promise<{ track: Track; bytes: Uint8Array } | { error: string }> {
  const looksAudio = file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);
  if (!looksAudio) return { error: `${file.name} isn’t an audio file.` };
  if (file.size <= 0) return { error: `${file.name} is empty.` };
  if (file.size > MAX_BYTES) {
    return { error: `${file.name} is over 8 MB. Shorter files stream straight from your browser.` };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const tags = readId3(bytes);
  const fallback = fromFilename(file.name);
  const mime = file.type || "audio/mpeg";
  const durationMs = Math.round(await measureDuration(toBlob(bytes, mime)));
  if (!durationMs) return { error: `Couldn’t read ${file.name}.` };
  if (durationMs > MAX_TRACK_MS) return { error: `${file.name} is longer than 20 minutes.` };
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
      ownerName: ownerName.slice(0, 24),
    },
  };
}

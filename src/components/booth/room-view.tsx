import { useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Loader2,
  Pause,
  Play,
  Plus,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { elapsedMs, formatTime, type BoothState, type Track } from "@/lib/booth/protocol";
import { useBooth } from "@/lib/booth/use-booth";
import { cn, tap } from "@/lib/cn";
import { Meter } from "./meter";
import { Wordmark } from "./wordmark";

function IconSwap({
  on,
  onIcon: OnIcon,
  offIcon: OffIcon,
}: {
  on: boolean;
  onIcon: typeof Play;
  offIcon: typeof Play;
}) {
  return (
    <span className="relative grid size-5 place-items-center">
      <OnIcon
        className={cn(
          "col-start-1 row-start-1 size-5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          on ? "scale-100 opacity-100 blur-none" : "scale-[0.25] opacity-0 blur-[4px]",
        )}
        aria-hidden="true"
      />
      <OffIcon
        className={cn(
          "col-start-1 row-start-1 size-5 transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]",
          on ? "scale-[0.25] opacity-0 blur-[4px]" : "scale-100 opacity-100 blur-none",
        )}
        aria-hidden="true"
      />
    </span>
  );
}

function Progress({
  stateRef,
  canSeek,
  onSeek,
}: {
  stateRef: RefObject<BoothState>;
  canSeek: boolean;
  onSeek: (ms: number) => void;
}) {
  const fillRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const totalRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
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

  function seekFrom(clientX: number, target: HTMLElement) {
    const duration = stateRef.current?.queue[0]?.durationMs ?? 0;
    if (!canSeek || duration <= 0) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(ratio * duration);
  }

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          "flex h-11 items-center",
          canSeek ? "cursor-pointer" : "cursor-default",
        )}
        onPointerDown={(event) => {
          if (!canSeek) return;
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
          seekFrom(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (!canSeek || event.buttons !== 1) return;
          seekFrom(event.clientX, event.currentTarget);
        }}
        role={canSeek ? "slider" : "progressbar"}
        aria-valuemin={0}
        aria-valuemax={stateRef.current?.queue[0]?.durationMs ?? 0}
        aria-label="Song position"
      >
        <span className="relative h-1.5 w-full rounded-full bg-raised">
          <span ref={fillRef} className="absolute inset-y-0 left-0 w-0 rounded-full bg-brass" />
        </span>
      </div>
      <div className="flex justify-between font-sans text-xs text-mist tabular-nums">
        <span ref={labelRef}>0:00</span>
        <span ref={totalRef}>0:00</span>
      </div>
    </div>
  );
}

export function RoomView({ code, name }: { code: string; name: string }) {
  const navigate = useNavigate();
  const booth = useBooth(code, name);
  const fileRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const stateRef = useRef(booth.state);
  stateRef.current = booth.state;

  const current = booth.state.queue[0] ?? null;
  const playing = Boolean(current && booth.state.live && !booth.state.paused);
  const haveCurrent = current ? booth.localIds.includes(current.id) : false;
  const ownerHere =
    !current ||
    current.ownerId === booth.selfId ||
    booth.peers.some((peer) => peer.id === current.ownerId);
  const hostPeer = booth.peers.find((peer) => peer.id === booth.state.hostId);
  const hostName = booth.isHost ? "You" : hostPeer?.name || "the host";

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
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

  function onFiles(list: FileList | File[] | null) {
    if (!list) return;
    void booth.addFiles([...list]);
  }

  const status = !booth.signalOk
    ? "Finding the room…"
    : !booth.state.hostId
      ? "Taking a seat…"
      : !current
        ? "The platter is empty."
        : !ownerHere
          ? "That song’s owner just left."
          : !haveCurrent && current.ownerId !== booth.selfId
            ? `Pulling this one from ${current.ownerName}…`
            : !booth.state.live
              ? "Holding until the room has it…"
              : booth.state.paused
                ? "Paused"
                : "On the platter";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pt-4 pb-40 sm:px-6 sm:pt-6 sm:pb-10">
      <header className="flex items-center justify-between gap-3">
        <button type="button" onClick={() => void navigate({ to: "/" })} className={cn(tap, "rounded-lg")}>
          <Wordmark />
          <span className="sr-only">Leave room</span>
        </button>
        <button
          type="button"
          onClick={() => void copyCode()}
          className={cn(
            tap,
            "flex h-11 items-center gap-2 rounded-full border border-line bg-panel pr-3 pl-4 text-sm text-cream",
          )}
        >
          <span className="font-display tracking-brand">{code}</span>
          <IconSwap on={copied} onIcon={Check} offIcon={Copy} />
          <span className="sr-only">{copied ? "Link copied" : "Copy room link"}</span>
        </button>
      </header>

      <p className="mt-4 text-sm text-mist">
        {booth.isHost
          ? "You’re hosting. Skip, pull, or reorder anything in the cue."
          : `${hostName} is hosting the cue. You can add songs and remove your own.`}
      </p>

      {booth.notice ? (
        <p
          className="mt-3 rounded-xl border border-line bg-raised px-3 py-2 text-sm text-cream"
          role="status"
        >
          {booth.notice}
        </p>
      ) : null}

      <section className="mt-5 grid items-center gap-6 rounded-card border border-line bg-panel p-4 sm:p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="mx-auto w-44 sm:w-52">
          <div
            className={cn(
              "vinyl vinyl-spin grid aspect-square place-items-center",
              playing ? "" : "is-paused",
            )}
          >
            <div className="vinyl-label grid size-[38%] place-items-center rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.2)]">
              <span className="size-2.5 rounded-full bg-ink" />
            </div>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-brand text-brass uppercase">{status}</p>
          <h1 className="mt-2 truncate font-display text-3xl font-medium text-cream sm:text-4xl">
            {current ? current.title : "Nothing queued"}
          </h1>
          <p className="mt-1 truncate text-sm text-mist">
            {current
              ? `${current.artist} · added by ${current.ownerId === booth.selfId ? "you" : current.ownerName}`
              : "Add an MP3 to start the room."}
          </p>
          {booth.pull && current && booth.pull.id === current.id ? (
            <p className="mt-2 text-xs text-mist tabular-nums">
              Receiving {Math.round(booth.pull.pct * 100)}%
            </p>
          ) : null}
          <div className="mt-3">
            <Meter audio={booth.audioEl} active={playing} />
          </div>
          <Progress
            stateRef={stateRef}
            canSeek={booth.isHost && Boolean(current && booth.state.live)}
            onSeek={booth.seek}
          />
        </div>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-ink/95 px-4 py-3 backdrop-blur-md sm:static sm:z-auto sm:mt-4 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0">
        <div className="mx-auto flex max-w-5xl items-center gap-2 sm:px-0">
          <button
            type="button"
            className={cn(
              tap,
              "grid size-12 place-items-center rounded-full bg-brass text-ink disabled:opacity-40",
            )}
            disabled={!booth.isHost || !current || !booth.state.live}
            onClick={booth.togglePause}
            aria-label={booth.state.paused ? "Play" : "Pause"}
          >
            <IconSwap on={!playing} onIcon={Play} offIcon={Pause} />
          </button>
          <button
            type="button"
            className={cn(
              tap,
              "grid size-12 place-items-center rounded-full border border-line bg-panel text-cream disabled:opacity-40",
            )}
            disabled={!booth.isHost || !current}
            onClick={booth.skip}
            aria-label="Skip"
          >
            <SkipForward className="size-5" aria-hidden="true" />
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={cn(tap, "grid size-11 place-items-center rounded-full text-cream")}
              onClick={() => booth.setVolume(booth.volume === 0 ? 0.9 : 0)}
              aria-label={booth.volume === 0 ? "Unmute" : "Mute"}
            >
              <IconSwap on={booth.volume === 0} onIcon={VolumeX} offIcon={Volume2} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={booth.volume}
              aria-label="Your volume"
              onChange={(event) => booth.setVolume(Number(event.target.value))}
              className="hidden w-28 sm:block"
            />
          </div>
        </div>
        {booth.needsGesture ? (
          <button
            type="button"
            className={cn(tap, "mx-auto mt-2 block text-sm text-brass")}
            onClick={booth.unlock}
          >
            Tap to listen
          </button>
        ) : null}
      </div>

      <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div
          className={cn(
            "rounded-card border border-dashed bg-panel/40 p-3 sm:p-4",
            dragging ? "border-brass" : "border-line",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onFiles(event.dataTransfer.files);
          }}
        >
          <div className="flex items-center justify-between gap-3 px-1">
            <h2 className="font-display text-xl text-cream">The cue</h2>
            <button
              type="button"
              className={cn(
                tap,
                "flex h-11 items-center gap-2 rounded-full bg-cream px-4 text-sm font-medium text-ink disabled:opacity-50",
              )}
              disabled={booth.importing}
              onClick={() => fileRef.current?.click()}
            >
              {booth.importing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Add songs
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.flac"
              multiple
              className="sr-only"
              onChange={(event) => {
                onFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </div>
          {booth.state.queue.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-mist">
              Drop MP3s here, or browse. They play from your browser — not from a server.
            </p>
          ) : (
            <ol className="mt-3 grid gap-1">
              {booth.state.queue.map((track, index) => (
                <QueueRow
                  key={track.id}
                  track={track}
                  index={index}
                  isSelf={track.ownerId === booth.selfId}
                  isHost={booth.isHost}
                  canMoveUp={booth.isHost && index > 1}
                  canMoveDown={booth.isHost && index > 0 && index < booth.state.queue.length - 1}
                  onDrop={() => booth.drop(track.id)}
                  onMove={(dir) => booth.move(track.id, dir)}
                />
              ))}
            </ol>
          )}
        </div>

        <aside className="rounded-card border border-line bg-panel p-4">
          <h2 className="font-display text-xl text-cream">In the room</h2>
          <ul className="mt-3 grid gap-2">
            <Person
              name={`${name} (you)`}
              detail={booth.isHost ? "Host" : booth.signalOk ? "Listening" : "Connecting"}
              live={booth.signalOk}
            />
            {booth.peers.map((peer) => (
              <Person
                key={peer.id}
                name={peer.name || "Listener"}
                detail={
                  peer.id === booth.state.hostId
                    ? "Host"
                    : peer.connectionState === "connected"
                      ? peer.rttMs != null
                        ? `Linked · ${peer.rttMs} ms`
                        : "Linked"
                      : peer.connectionState === "failed"
                        ? "Can’t link directly"
                        : "Joining"
                }
                live={peer.connectionState === "connected"}
              />
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-mist">
            Songs stream from the person who added them. No cloud bucket. If their tab closes,
            that song stops for everyone. A direct link can fail on some networks — they’ll show
            as unable to link.
          </p>
        </aside>
      </section>
    </main>
  );
}

function Person({ name, detail, live }: { name: string; detail: string; live: boolean }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-raised px-3 py-2">
      <span
        className={cn("size-2.5 shrink-0 rounded-full", live ? "bg-brass" : "bg-line")}
        aria-hidden="true"
      />
      <span className="min-w-0">
        <span className="block truncate text-sm text-cream">{name}</span>
        <span className="block text-xs text-mist">{detail}</span>
      </span>
    </li>
  );
}

function QueueRow({
  track,
  index,
  isSelf,
  isHost,
  canMoveUp,
  canMoveDown,
  onDrop,
  onMove,
}: {
  track: Track;
  index: number;
  isSelf: boolean;
  isHost: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onDrop: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const canRemove = isHost || isSelf;
  return (
    <li className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-raised">
      <span className="flex w-8 shrink-0 items-center justify-center text-xs text-mist tabular-nums">
        {index === 0 ? <span className="size-1.5 rounded-full bg-brass" aria-hidden="true" /> : index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-cream">{track.title}</span>
        <span className="block truncate text-xs text-mist">
          {track.artist} · {isSelf ? "you" : track.ownerName}
        </span>
      </span>
      <span className="shrink-0 text-xs text-mist tabular-nums">{formatTime(track.durationMs)}</span>
      {isHost && index > 0 ? (
        <span className="flex shrink-0">
          <button
            type="button"
            className={cn(tap, "grid size-11 place-items-center rounded-lg text-mist disabled:opacity-30")}
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            aria-label={`Move ${track.title} up`}
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            className={cn(tap, "grid size-11 place-items-center rounded-lg text-mist disabled:opacity-30")}
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            aria-label={`Move ${track.title} down`}
          >
            <ChevronDown className="size-4" />
          </button>
        </span>
      ) : null}
      {canRemove ? (
        <button
          type="button"
          className={cn(tap, "grid size-11 shrink-0 place-items-center rounded-lg text-mist")}
          onClick={onDrop}
          aria-label={`Remove ${track.title}`}
        >
          <Trash2 className="size-4" />
        </button>
      ) : null}
    </li>
  );
}

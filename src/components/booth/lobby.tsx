import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Disc3, Radio, Unplug } from "lucide-react";
import { makeCode } from "@/lib/booth/protocol";
import { cn, tap } from "@/lib/cn";
import { Wordmark } from "./wordmark";

const NOTES = [
  {
    icon: Radio,
    title: "Heard at the same time",
    body: "The room keeps one playhead. Everyone is on the same second.",
  },
  {
    icon: Unplug,
    title: "Leaves when you leave",
    body: "A song plays from the browser that added it. Close the tab and it drops out of the queue.",
  },
  {
    icon: Disc3,
    title: "The host runs the cue",
    body: "Whoever opens the room can skip, pull a song, or move the line. No account, no storage.",
  },
];

export function Lobby() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("sidea:name");
    if (saved) setName(saved);
  }, []);

  function seat(nextCode: string) {
    const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 24);
    if (!trimmed) {
      setError("Add your name so the room knows who queued the song.");
      return;
    }
    const room = nextCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    if (room.length < 4) {
      setError("Room codes are 4 to 6 letters.");
      return;
    }
    localStorage.setItem("sidea:name", trimmed);
    void navigate({ to: "/r/$code", params: { code: room } });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-5 py-6 sm:px-8 sm:py-8">
      <header className="flex items-center justify-between gap-4">
        <Wordmark />
        <p className="text-right text-sm text-mist">Files stay on your device</p>
      </header>

      <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:py-16">
        <section className="rise">
          <p className="text-xs font-medium tracking-brand text-brass uppercase">
            A private listening room
          </p>
          <h1 className="mt-3 font-display text-4xl leading-tight font-medium text-cream sm:text-6xl">
            Same song.
            <span className="block italic text-brass">Same second.</span>
          </h1>
          <p className="mt-5 max-w-md text-base text-mist sm:text-lg">
            Drop in MP3s from your own library. Friends in the room hear them with you.
            Nothing is uploaded — if you disconnect, your songs stop.
          </p>
          <ul className="mt-8 grid gap-4">
            {NOTES.map((note) => (
              <li key={note.title} className="flex gap-3">
                <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-panel text-brass">
                  <note.icon className="size-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-cream">{note.title}</span>
                  <span className="mt-0.5 block text-sm text-mist">{note.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <form
          className="rise rise-2 lift rounded-card border border-line bg-panel p-5 sm:p-7"
          onSubmit={(event) => {
            event.preventDefault();
            seat(code.trim() ? code : makeCode());
          }}
        >
          <label className="block text-sm font-medium text-cream" htmlFor="listener-name">
            Your name
          </label>
          <input
            id="listener-name"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            placeholder="What should the room call you?"
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
            className="mt-2 h-12 w-full rounded-xl border border-line bg-ink px-3 text-base text-cream outline-none placeholder:text-mist"
          />

          <button
            type="button"
            className={cn(
              tap,
              "mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brass text-base font-medium text-ink",
            )}
            onClick={() => seat(makeCode())}
          >
            Open a room
            <ArrowRight className="size-4" aria-hidden="true" />
          </button>

          <div className="my-5 flex items-center gap-3 text-xs tracking-brand text-mist uppercase">
            <span className="h-px flex-1 bg-line" />
            or take a seat
            <span className="h-px flex-1 bg-line" />
          </div>

          <label className="block text-sm font-medium text-cream" htmlFor="room-code">
            Room code
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="room-code"
              value={code}
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="K7MQP"
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setError(null);
              }}
              className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-ink px-3 font-display text-lg tracking-brand text-cream uppercase outline-none placeholder:text-mist placeholder:tracking-brand"
            />
            <button
              type="button"
              className={cn(
                tap,
                "h-12 shrink-0 rounded-xl border border-line bg-raised px-4 text-sm font-medium text-cream",
              )}
              onClick={() => seat(code)}
            >
              Join
            </button>
          </div>
          {error ? (
            <p className="mt-3 text-sm text-brass" role="alert">
              {error}
            </p>
          ) : (
            <p className="mt-3 text-sm text-mist">
              Share the code after you’re in. Up to eight people, songs under 8 MB.
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

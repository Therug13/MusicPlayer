import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { RoomView } from "@/components/booth/room-view";
import { Wordmark } from "@/components/booth/wordmark";
import { cn, tap } from "@/lib/cn";

export const Route = createFileRoute("/r/$code")({
  component: RoomPage,
});

function RoomPage() {
  const { code: raw } = Route.useParams();
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  const navigate = useNavigate();
  const [name, setName] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!/^[A-Z0-9]{4,6}$/.test(code)) {
      void navigate({ to: "/" });
      return;
    }
    const saved = localStorage.getItem("sidea:name")?.trim();
    if (saved) setName(saved.slice(0, 24));
    setReady(true);
  }, [code, navigate]);

  if (!ready || !/^[A-Z0-9]{4,6}$/.test(code)) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-mist">
        <p>Opening the room…</p>
      </main>
    );
  }

  if (!name) {
    return (
      <main className="mx-auto grid min-h-dvh w-full max-w-md place-items-center px-5">
        <form
          className="w-full rounded-card border border-line bg-panel p-6"
          onSubmit={(event) => {
            event.preventDefault();
            const next = draft.trim().replace(/\s+/g, " ").slice(0, 24);
            if (!next) return;
            localStorage.setItem("sidea:name", next);
            setName(next);
          }}
        >
          <Wordmark />
          <h1 className="mt-4 font-display text-3xl text-cream">Room {code}</h1>
          <p className="mt-2 text-sm text-mist">What should everyone call you?</p>
          <input
            value={draft}
            autoFocus
            maxLength={24}
            onChange={(event) => setDraft(event.target.value)}
            className="mt-4 h-12 w-full rounded-xl border border-line bg-ink px-3 text-base text-cream outline-none"
            placeholder="Your name"
          />
          <button
            type="submit"
            className={cn(tap, "mt-3 h-12 w-full rounded-xl bg-brass text-sm font-medium text-ink")}
          >
            Take a seat
          </button>
        </form>
      </main>
    );
  }

  return <RoomView key={`${code}:${name}`} code={code} name={name} />;
}

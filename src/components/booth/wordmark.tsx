import { cn } from "@/lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display text-xl font-medium tracking-tight text-cream", className)}>
      Side <span className="text-brass italic">A</span>
    </span>
  );
}

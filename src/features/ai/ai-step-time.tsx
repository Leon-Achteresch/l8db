import { useEffect, useState } from "react";
import { duration } from "@/lib/ai/duration";

export function AiStepTime({
  start,
  end,
  running,
}: {
  start?: number;
  end?: number;
  running: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const ticking = running && start !== undefined && end === undefined;
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  if (start === undefined || (end === undefined && !ticking)) return null;
  const ms = Math.max(0, (end ?? now) - start);
  if (ticking && ms < 1000) return null;
  return (
    <span className="shrink-0 pl-2 text-[11.5px] tabular-nums text-muted-foreground/70">
      {ms < 1000 ? "<1 s" : ticking && ms < 60_000 ? `${Math.floor(ms / 1000)} s` : duration(ms)}
    </span>
  );
}

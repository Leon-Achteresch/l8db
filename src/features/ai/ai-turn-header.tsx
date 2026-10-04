import { useEffect, useState } from "react";
import { AiWorkRow } from "./ai-work-row";

function duration(ms: number) {
  if (ms < 1000) return "unter 1 s";
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function AiTurnHeader({
  streaming,
  startedAt,
  durationMs,
  stopped,
  steps,
  open,
  onToggle,
}: {
  streaming: boolean;
  startedAt?: number;
  durationMs?: number;
  stopped?: boolean;
  steps: number;
  open?: boolean;
  onToggle?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) * 1000 : 0;
  const count = steps === 1 ? "1 Schritt" : `${steps} Schritte`;
  const label = streaming
    ? elapsed >= 1000
      ? `Arbeitet · ${duration(elapsed)}`
      : "Arbeitet …"
    : stopped
      ? durationMs !== undefined
        ? `Gestoppt nach ${duration(durationMs)}`
        : "Gestoppt"
      : `${steps ? `${count} · ` : ""}${duration(durationMs ?? 0)}`;
  return (
    <div className="tabular-nums">
      <AiWorkRow
        tone={streaming ? "active" : stopped ? "failed" : "lead"}
        label={label}
        onToggle={onToggle}
        open={open}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import { EPISODE_KINDS } from "@/features/transfer/cinema/transfer-cinema-episodes";
import type { EpisodeKind } from "@/features/transfer/cinema/transfer-cinema-sim";
import { TransferCinemaStage } from "@/features/transfer/cinema/transfer-cinema-stage";
import { cn } from "@/lib/utils";
import { TransferCinemaOverlayPreview } from "./transfer-cinema-overlay-preview";

const EPISODE_LABELS: Record<EpisodeKind, string> = {
  coffee: "Kaffeepause",
  deadlock: "Deadlock",
  vacuum: "VACUUM",
  conga: "Polonaise",
  snail: "Latenz",
  fortress: "Indexburg",
  rain: "Zeilenregen",
  party: "Rollback-Party",
};

const DURATIONS = [
  { label: "15 s", seconds: 15 },
  { label: "2 min", seconds: 120 },
  { label: "10 min", seconds: 600 },
];

const SPEEDS = [1, 4, 12];

const TABLES = ["users", "orders", "order_items", "invoices", "customers", "payments", "audit_log"];

const button =
  "h-8 rounded-md border px-3 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
const input =
  "h-8 w-36 rounded-md border bg-background px-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function TransferCinematicLab() {
  const [sourceName, setSourceName] = useState("staging_db");
  const [targetName, setTargetName] = useState("prod_shop");
  const [duration, setDuration] = useState(120);
  const [speed, setSpeed] = useState(1);
  const [fail, setFail] = useState(false);
  const [paused, setPaused] = useState(false);
  const [run, setRun] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [episode, setEpisode] = useState<{ kind: EpisodeKind; id: number } | null>(null);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 0.1 * speed), 100);
    return () => window.clearInterval(timer);
  }, [paused, speed]);

  const restart = () => {
    setElapsed(0);
    setEpisode(null);
    setRun(run + 1);
  };
  const progress = Math.min(1, elapsed / duration);
  const done = elapsed >= duration;
  const outcome = done ? (fail ? "failure" : "success") : "running";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">Transfer-Animation</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Läuft im Transfer-Overlay, solange der Transfer dauert. Zwischen dem Schusswechsel
            kommen wechselnde Episoden, am Ende das Flaggschiff oder ein ROLLBACK.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            aria-label="Name der Quelle"
            value={sourceName}
            onChange={(event) => setSourceName(event.target.value)}
            className={input}
          />
          <span className="text-muted-foreground">nach</span>
          <input
            aria-label="Name des Ziels"
            value={targetName}
            onChange={(event) => setTargetName(event.target.value)}
            className={input}
          />
          <button type="button" onClick={restart} className={button}>
            Neu starten
          </button>
          <TransferCinemaOverlayPreview
            sourceName={sourceName}
            targetName={targetName}
            seconds={Math.min(duration, 120)}
            fail={fail}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Transferdauer</legend>
          <span className="mr-1 text-muted-foreground">Dauer</span>
          {DURATIONS.map((entry) => (
            <button
              key={entry.seconds}
              type="button"
              aria-pressed={duration === entry.seconds}
              onClick={() => {
                setDuration(entry.seconds);
                restart();
              }}
              className={cn(button, duration === entry.seconds && "bg-muted font-medium")}
            >
              {entry.label}
            </button>
          ))}
        </fieldset>
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Tempo</legend>
          <span className="mr-1 text-muted-foreground">Tempo</span>
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={speed === value}
              onClick={() => setSpeed(value)}
              className={cn(button, speed === value && "bg-muted font-medium")}
            >
              {value}×
            </button>
          ))}
        </fieldset>
        <button
          type="button"
          aria-pressed={fail}
          onClick={() => setFail(!fail)}
          className={cn(button, fail && "bg-muted font-medium")}
        >
          Endet mit Fehler
        </button>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
          className={cn(button, paused && "bg-muted font-medium")}
        >
          Pause
        </button>
        <button
          type="button"
          disabled={done}
          onClick={() => setElapsed(duration)}
          className={cn(button, "disabled:opacity-50")}
        >
          Jetzt beenden
        </button>
      </div>
      <TransferCinemaStage
        key={run}
        sourceName={sourceName}
        targetName={targetName}
        speed={speed}
        paused={paused}
        seed={run + 7}
        episode={episode}
        input={{
          progress,
          rows: Math.floor(progress * 1_842_330),
          table: TABLES[Math.min(TABLES.length - 1, Math.floor(progress * TABLES.length))],
          outcome,
        }}
        className="rounded-xl border"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-mono tabular-nums text-muted-foreground">
          {Math.min(elapsed, duration).toFixed(0)} / {duration} s · {Math.round(progress * 100)} %
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-muted-foreground">Episode starten</span>
          {EPISODE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={done}
              onClick={() => setEpisode({ kind, id: (episode?.id ?? 0) + 1 })}
              className={cn(button, "disabled:opacity-50")}
            >
              {EPISODE_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { CopyIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTime } from "@/lib/automation/format";
import { toast } from "@/lib/automation/toast";
import type { LogLevel, LogLine, StepRun } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

interface Props {
  logs: LogLine[];
  steps: StepRun[];
  live: boolean;
}

type LevelFilter = "all" | "info" | "warn" | "error";

const LEVELS: { value: LevelFilter; label: string }[] = [
  { value: "all", label: "Alle" },
  { value: "info", label: "Info" },
  { value: "warn", label: "Warnungen" },
  { value: "error", label: "Fehler" },
];

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const TAG: Record<LogLevel, { text: string; className: string }> = {
  debug: { text: "DEBUG", className: "text-muted-foreground/70" },
  info: { text: "INFO", className: "text-muted-foreground" },
  warn: { text: "WARN", className: "text-amber-700 dark:text-amber-400" },
  error: { text: "FEHLER", className: "text-destructive" },
};

export function RunLog({ logs, steps, live }: Props) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [step, setStep] = useState("all");
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const stepNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of steps)
      if (!names.has(entry.stepId)) names.set(entry.stepId, entry.stepName);
    return names;
  }, [steps]);
  const visible = useMemo(
    () =>
      logs.filter(
        (line) =>
          (level === "all" || RANK[line.level] >= RANK[level]) &&
          (step === "all" || line.stepId === step),
      ),
    [logs, level, step],
  );

  useEffect(() => {
    const element = scroller.current;
    if (live && element && pinned.current && visible.length)
      element.scrollTop = element.scrollHeight;
  }, [visible.length, live]);

  const copy = async () => {
    const text = visible
      .map(
        (line) =>
          `${line.at}\t${line.level.toUpperCase()}\t${line.stepId ? `${stepNames.get(line.stepId) ?? line.stepId}\t` : ""}${line.message}`,
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(
        visible.length === 1 ? "1 Logzeile kopiert" : `${visible.length} Logzeilen kopiert`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-72">
          <SegmentedControl value={level} onChange={setLevel} options={LEVELS} label="Level" />
        </div>
        <Select value={step} onValueChange={setStep}>
          <SelectTrigger size="sm" className="h-7 max-w-56 text-xs" aria-label="Schritt">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Schritte</SelectItem>
            {[...stepNames.entries()].map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          disabled={visible.length === 0}
          onClick={() => void copy()}
        >
          <CopyIcon />
          Kopieren
        </Button>
      </div>
      <div
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
        }}
        className="max-h-80 min-h-24 overflow-auto rounded-xl border bg-muted/30 py-2 font-mono text-xs leading-5"
      >
        {visible.length === 0 ? (
          <p className="px-3 font-sans text-xs text-muted-foreground">
            {logs.length ? "Keine Zeilen für diesen Filter." : "Keine Logzeilen."}
          </p>
        ) : (
          <ol>
            {visible.map((line) => (
              <li
                key={line.seq}
                className="grid grid-cols-[4.5rem_3.5rem_1fr] gap-x-2 px-3 hover:bg-muted/60"
              >
                <span className="tabular-nums text-muted-foreground">{formatTime(line.at)}</span>
                <span className={cn("font-semibold", TAG[line.level].className)}>
                  {TAG[line.level].text}
                </span>
                <span className="min-w-0 break-words whitespace-pre-wrap">
                  {line.stepId && stepNames.get(line.stepId) && (
                    <span className="text-muted-foreground">{stepNames.get(line.stepId)} · </span>
                  )}
                  {line.message}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

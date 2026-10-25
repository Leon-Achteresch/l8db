import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LOG_SOURCES,
  type LogLevel,
  type LogSource,
  type ObservabilityLogRow,
  supabaseStudioObservabilityLogs,
} from "@/lib/db/supabase-studio-observability";
import { DatabaseTable } from "../database/database-table";
import { formatLogTimestamp, type LogsTabProps, logsQueryKey, logTone } from "./logs-format";
import { LogsRowDetail } from "./logs-row-detail";

const RANGES = [
  { minutes: 15, label: "Letzte 15 min" },
  { minutes: 60, label: "Letzte Stunde" },
  { minutes: 180, label: "Letzte 3 h" },
  { minutes: 1440, label: "Letzte 24 h" },
  { minutes: 10080, label: "Letzte 7 Tage" },
];

const LEVELS: { id: LogLevel | "all"; label: string }[] = [
  { id: "all", label: "Alle Level" },
  { id: "error", label: "Fehler" },
  { id: "warning", label: "Warnungen" },
  { id: "info", label: "Info" },
];

const LIMITS = [100, 250, 500];

export function LogsExplorerTab({ reference, refetchInterval }: LogsTabProps) {
  const [source, setSource] = useState<LogSource>("edge_logs");
  const [minutes, setMinutes] = useState(60);
  const [level, setLevel] = useState<LogLevel>("");
  const [limit, setLimit] = useState(100);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<ObservabilityLogRow | null>(null);
  const levels = LOG_SOURCES.find((item) => item.id === source)?.levels ?? false;
  const effectiveLevel = levels ? level : "";
  const query = useQuery({
    queryKey: logsQueryKey(reference, "logs", source, minutes, search, effectiveLevel, limit),
    queryFn: () =>
      supabaseStudioObservabilityLogs(reference, {
        source,
        minutes,
        search,
        level: effectiveLevel,
        limit,
      }),
    placeholderData: keepPreviousData,
    refetchInterval,
  });
  const rows = query.data?.rows ?? [];
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <Select value={source} onValueChange={(value) => setSource(value as LogSource)}>
          <SelectTrigger size="sm" className="h-8 w-52 text-xs" aria-label="Quelle">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_SOURCES.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(minutes)} onValueChange={(value) => setMinutes(Number(value))}>
          <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label="Zeitraum">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGES.map((item) => (
              <SelectItem key={item.minutes} value={String(item.minutes)} className="text-xs">
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={effectiveLevel || "all"}
          onValueChange={(value) => setLevel(value === "all" ? "" : (value as LogLevel))}
          disabled={!levels}
        >
          <SelectTrigger
            size="sm"
            className="h-8 w-32 text-xs"
            aria-label="Level"
            title={levels ? undefined : "Für diese Quelle gibt es keinen Level-Filter."}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((item) => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value))}>
          <SelectTrigger size="sm" className="h-8 w-28 text-xs" aria-label="Anzahl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMITS.map((item) => (
              <SelectItem key={item} value={String(item)} className="text-xs">
                {item} Einträge
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-48 flex-1">
          <Search className="absolute top-2 left-2 size-4 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            value={draft}
            maxLength={200}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Nachricht durchsuchen…"
            aria-label="Nachricht durchsuchen"
          />
        </div>
        <Button type="submit" size="sm" className="h-8 text-xs">
          Suchen
        </Button>
      </form>
      {query.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(query.error)}
        </p>
      ) : query.isPending ? (
        <p className="text-xs text-muted-foreground">Wird geladen…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine Logeinträge im Zeitraum.</p>
      ) : (
        <div className="max-h-[560px] overflow-auto rounded-xl border">
          <DatabaseTable headers={["Zeitpunkt", "Nachricht"]}>
            {rows.map((row) => {
              const tone = logTone(row.event_message);
              return (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setDetail(row)}
                >
                  <td
                    className={`border-l-2 whitespace-nowrap tabular-nums ${
                      tone === "error"
                        ? "border-l-destructive"
                        : tone === "warning"
                          ? "border-l-amber-500"
                          : "border-l-transparent"
                    }`}
                  >
                    {formatLogTimestamp(row.timestamp)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="line-clamp-2 text-left font-mono break-all"
                      onClick={() => setDetail(row)}
                    >
                      {row.event_message ?? "–"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </DatabaseTable>
        </div>
      )}
      {query.data?.has_more && (
        <p className="text-xs text-muted-foreground">
          Es gibt weitere Einträge. Zeitraum verkleinern oder Suche eingrenzen.
        </p>
      )}
      <LogsRowDetail row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/clipboard";
import { clearSqlLog, configureSqlLog, readSqlLog, type SqlLogEntry } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const KEEP = 5000;
const SHOWN = 300;

const time = (at: number) => new Date(at).toLocaleTimeString("de-DE", { hour12: false });

const asText = (entry: SqlLogEntry) =>
  `-- ${time(entry.at_ms)} ${entry.source || "–"} ${entry.kind} ${entry.duration_ms.toFixed(1)} ms${
    entry.rows === null ? "" : ` ${entry.rows} Zeilen`
  }${entry.error ? ` FEHLER: ${entry.error.split("\n")[0]}` : ""}\n${entry.sql};`;

export function SqlLogPanel() {
  const [enabled, setEnabled] = useState(false);
  const [entries, setEntries] = useState<SqlLogEntry[]>([]);
  const [filter, setFilter] = useState("");
  const last = useRef(0);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("tasks.sql-log");

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const page = await readSqlLog(last.current).catch(() => null);
      if (!alive || !page) return;
      setEnabled(page.enabled);
      if (page.entries.length === 0) return;
      last.current = page.entries[page.entries.length - 1].id;
      setEntries((current) => [...current, ...page.entries].slice(-KEEP));
    };
    void poll();
    const timer = setInterval(() => void poll(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const matching = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? entries.filter(
          (e) =>
            e.sql.toLowerCase().includes(needle) ||
            e.source.toLowerCase().includes(needle) ||
            (e.error ?? "").toLowerCase().includes(needle),
        )
      : entries;
    return list.slice(-SHOWN).reverse();
  }, [entries, filter]);

  const toggle = (value: boolean) => {
    setEnabled(value);
    configureSqlLog(value).catch((error) => toast.error(String(error)));
  };

  const clear = () => {
    setEntries([]);
    clearSqlLog().catch((error) => toast.error(String(error)));
  };

  return (
    <div ref={ref} className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="sql-log-enabled" className="flex items-center gap-2 text-sm">
          <Switch id="sql-log-enabled" checked={enabled} onCheckedChange={toggle} />
          Protokollieren
        </label>
        {isNew && <NewBadge />}
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="SQL, Quelle oder Fehler filtern"
          className="h-8 max-w-xs text-xs"
        />
        <span className="text-xs text-muted-foreground tabular-nums">
          {entries.length} Einträge
        </span>
        <span className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length === 0}
            onClick={() => void copyText(entries.map(asText).join("\n\n"), "SQL-Protokoll kopiert")}
          >
            Kopieren
          </Button>
          <Button variant="outline" size="sm" disabled={entries.length === 0} onClick={clear}>
            Leeren
          </Button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Zeichnet jede Datenbankanfrage der App auf, auch Metadaten und Autovervollständigung (Oracle
        vollständig, PostgreSQL nur Editor-Abfragen). Die letzten {KEEP} Einträge bleiben erhalten.
      </p>
      <div className="max-h-[55vh] overflow-auto rounded-md border">
        {matching.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {enabled ? "Noch keine Einträge." : "Protokoll ist ausgeschaltet."}
          </p>
        ) : (
          <ul className="divide-y divide-border/50 text-xs">
            {matching.map((entry) => (
              <li key={entry.id} className="space-y-1 px-3 py-2">
                <div className="flex gap-3 text-muted-foreground tabular-nums">
                  <span>{time(entry.at_ms)}</span>
                  <span className="font-medium text-foreground">{entry.source || "–"}</span>
                  <span>{entry.kind}</span>
                  <span>{entry.duration_ms.toFixed(1)} ms</span>
                  {entry.rows !== null && <span>{entry.rows} Zeilen</span>}
                </div>
                <pre className="whitespace-pre-wrap break-all font-mono">{entry.sql}</pre>
                {entry.error && (
                  <p className="whitespace-pre-wrap break-words text-destructive">{entry.error}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

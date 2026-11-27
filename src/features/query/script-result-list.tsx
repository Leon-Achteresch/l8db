import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CircleDashedIcon,
  CircleMinusIcon,
  CopyIcon,
  ListFilterIcon,
  LoaderIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { copyWithToast } from "@/lib/clipboard";
import type { QueryResult } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { sqlPreviewLine } from "@/lib/sql-preview-line";
import { scriptTranscript } from "@/lib/sqlplus-output";
import { ScriptEntryOutput } from "./script-entry-output";
import { scriptPageForEntry, scriptResultPage } from "./script-result-page";

export type ScriptRunStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "skipped"
  | "ignored";

export interface ScriptRunMessage {
  level: string;
  message: string;
  detail?: string | null;
}

export interface ScriptRunEntry {
  index: number;
  sql: string;
  start: number;
  end: number;
  status: ScriptRunStatus;
  durationMs: number | null;
  rowCount: number | null;
  rowsAffected: number | null;
  error: string | null;
  source?: string;
  result?: QueryResult;
  output?: ScriptRunMessage[];
  feedback?: string | null;
  note?: string;
}

interface ScriptResultListProps {
  entries: ScriptRunEntry[];
  activeIndex: number | null;
  onSelect: (entry: ScriptRunEntry) => void;
  onClose: () => void;
  note: string;
  featureId?: "query.sqlplus-session";
  issuesFeatureId?: "query.results.script-issues" | "import.sql.result-issues";
}

function statusIcon(status: ScriptRunStatus) {
  if (status === "success") return <CheckCircle2Icon className="size-3.5 text-emerald-500" />;
  if (status === "error") return <XCircleIcon className="size-3.5 text-destructive" />;
  if (status === "warning") return <AlertTriangleIcon className="size-3.5 text-amber-500" />;
  if (status === "running") return <LoaderIcon className="size-3.5 animate-spin" />;
  if (status === "ignored") return <CircleMinusIcon className="size-3.5 text-amber-500" />;
  return <CircleDashedIcon className="size-3.5 text-muted-foreground" />;
}

function detailOf(entry: ScriptRunEntry): string {
  const parts: string[] = [];
  if (entry.rowCount !== null)
    parts.push(`${entry.rowCount} ${entry.rowCount === 1 ? "Zeile" : "Zeilen"}`);
  if (entry.rowsAffected !== null) parts.push(`${entry.rowsAffected} betroffen`);
  if (entry.durationMs !== null) parts.push(`${entry.durationMs} ms`);
  if (entry.status === "skipped") parts.push("nicht ausgeführt");
  if (entry.status === "ignored") parts.push("ignoriert (SQL*Plus-Befehl)");
  return parts.join(" · ");
}

function revealSelectedStatement(button: HTMLButtonElement | null) {
  button?.scrollIntoView({ block: "nearest" });
}

export function ScriptResultList({
  entries,
  activeIndex,
  onSelect,
  onClose,
  note,
  featureId,
  issuesFeatureId = "query.results.script-issues",
}: ScriptResultListProps) {
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [page, setPage] = useState(() => scriptPageForEntry(entries, activeIndex));
  const { done, failed, warned, count, currentPage, lastPage, start, end, visible } = useMemo(
    () => scriptResultPage(entries, page, issuesOnly),
    [entries, page, issuesOnly],
  );
  const { ref, isNew } = useNewFeatureVisibility<HTMLSpanElement>(featureId);
  const output = useNewFeatureVisibility<HTMLButtonElement>("query.script-output");
  const filter = useNewFeatureVisibility<HTMLButtonElement>(issuesFeatureId);

  return (
    <div className="flex max-h-64 shrink-0 flex-col border-t bg-card/40">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3 text-xs">
        <span ref={ref} className="flex items-center gap-1 font-medium">
          Skriptausführung
          {isNew && <NewBadge />}
        </span>
        <span className="text-muted-foreground">
          {done}/{entries.length} erfolgreich
          {failed > 0 ? ` · ${failed} fehlgeschlagen` : ""}
          {warned > 0 ? ` · ${warned} mit Warnung` : ""}
        </span>
        <span className="truncate text-muted-foreground">· {note}</span>
        <Button
          ref={output.ref}
          size={output.isNew ? "sm" : "icon"}
          variant="ghost"
          className={output.isNew ? "ml-auto h-6 gap-1 px-1.5" : "ml-auto size-6"}
          aria-label="Skriptprotokoll kopieren"
          title="Vollständiges Protokoll kopieren"
          onClick={() => void copyWithToast(scriptTranscript(entries), "Skriptprotokoll")}
        >
          <CopyIcon className="size-3" />
          {output.isNew && <NewBadge />}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          aria-label="Skriptergebnisse schließen"
          onClick={onClose}
        >
          <XIcon className="size-3" />
        </Button>
      </div>
      {(failed + warned > 0 || issuesOnly || lastPage > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-1 text-xs">
          {(failed + warned > 0 || issuesOnly) && (
            <Button
              ref={filter.ref}
              size="xs"
              variant={issuesOnly ? "secondary" : "ghost"}
              aria-pressed={issuesOnly}
              onClick={() => {
                setIssuesOnly(!issuesOnly);
                setPage(issuesOnly ? scriptPageForEntry(entries, activeIndex) : 0);
              }}
            >
              <ListFilterIcon />
              Nur Fehler und Warnungen
              {filter.isNew && <NewBadge />}
            </Button>
          )}
          {lastPage > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-muted-foreground tabular-nums">
                {start + 1}–{end} von {count}
              </span>
              {lastPage > 1 && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Erste Statements"
                  disabled={currentPage === 0}
                  onClick={() => setPage(0)}
                >
                  <ChevronsLeftIcon />
                </Button>
              )}
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Vorherige Statements"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Nächste Statements"
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRightIcon />
              </Button>
              {lastPage > 1 && (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Letzte Statements"
                  disabled={currentPage === lastPage}
                  onClick={() => setPage(lastPage)}
                >
                  <ChevronsRightIcon />
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <section
        key={`${issuesOnly}-${currentPage}`}
        aria-label="Statement-Ergebnisse"
        className="min-h-0 overflow-y-auto overscroll-contain"
      >
        <div className="divide-y">
          {issuesOnly && count === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">Keine Fehler oder Warnungen.</p>
          )}
          {visible.map((entry) => (
            <button
              key={entry.index}
              ref={activeIndex === entry.index ? revealSelectedStatement : undefined}
              type="button"
              aria-pressed={activeIndex === entry.index}
              onClick={() => onSelect(entry)}
              className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent/50 ${
                activeIndex === entry.index ? "bg-accent/60" : ""
              }`}
            >
              <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                {entry.index + 1}
              </span>
              <span className="mt-0.5 shrink-0">{statusIcon(entry.status)}</span>
              {entry.status === "error" && <span className="sr-only">Fehler</span>}
              {entry.status === "warning" && <span className="sr-only">Warnung</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono">
                  {sqlPreviewLine(entry.sql, 120, "")}
                </span>
                {entry.source && (
                  <span className="block truncate text-muted-foreground">aus {entry.source}</span>
                )}
                {entry.error && (
                  <span className="block whitespace-pre-wrap break-words text-destructive">
                    {entry.error}
                  </span>
                )}
                <ScriptEntryOutput entry={entry} />
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{detailOf(entry)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

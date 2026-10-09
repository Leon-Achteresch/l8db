import { ChevronRightIcon, CircleXIcon, CopyIcon, LightbulbIcon, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import type { DatabaseKind } from "@/lib/db";
import { impactCallMarkers, type SqlMarker, sqlErrorMarkers } from "@/lib/sql-diagnostics";
import { sqlErrorInsight } from "./sql-error-insight";

interface ResultErrorProps {
  error: string;
  kind?: DatabaseKind;
  source?: { text: string; base: number } | null;
  sql?: string;
  columns?: string[];
  tables?: string[];
  onReveal?: (marker: SqlMarker) => void;
  onReplace?: (start: number, end: number, text: string) => void;
  onFixWithAi?: () => void;
}

export function ResultError({
  error,
  kind,
  source,
  sql,
  columns,
  tables,
  onReveal,
  onReplace,
  onFixWithAi,
}: ResultErrorProps) {
  const insight = useMemo(
    () => sqlErrorInsight({ error, kind, source, sql, columns, tables }),
    [error, kind, source, sql, columns, tables],
  );
  const target: SqlMarker | null = insight.fix
    ? {
        start: insight.fix.start,
        end: insight.fix.end,
        message: insight.summary,
        severity: "error",
      }
    : insight.marker;
  const meta = [
    insight.line !== null ? `Zeile ${insight.line}, Spalte ${insight.column}` : null,
    insight.code,
  ].filter(Boolean);
  const multiline = error.trim().includes("\n") || error.trim() !== insight.summary;

  return (
    <div className="h-full overflow-auto">
      <div
        role="alert"
        className="border-l-2 border-destructive bg-destructive/5 px-4 py-3 dark:bg-destructive/10"
      >
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <CircleXIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words text-foreground">{insight.summary}</p>
            {meta.length > 0 && (
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {meta.join(" · ")}
                {insight.codeLabel && <span> · {insight.codeLabel}</span>}
              </p>
            )}
            {insight.suggestion && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <LightbulbIcon className="size-3.5 shrink-0 text-amber-500" />
                <span>
                  Meintest du{" "}
                  <code className="font-mono text-foreground">{insight.suggestion}</code>?
                </span>
              </p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {insight.fix && onReplace && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  const fix = insight.fix;
                  if (fix) onReplace(fix.start, fix.end, fix.text);
                }}
              >
                <code className="font-mono">{insight.fix.text}</code> einsetzen
              </Button>
            )}
            {onFixWithAi && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onFixWithAi}>
                <Sparkles className="size-3.5" />
                Mit KI beheben
              </Button>
            )}
            {target && onReveal && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => onReveal(target)}
              >
                Zur Stelle
              </Button>
            )}
            <IconButton
              variant="ghost"
              size="icon-sm"
              aria-label="Fehler kopieren"
              onClick={() => void copyText(error, "Fehler kopiert")}
            >
              <CopyIcon />
            </IconButton>
          </div>
        </div>
      </div>
      {multiline && (
        <details className="group px-4 py-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
            Details
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
            {error.split("\n").map((line, index, lines) => {
              const marker = source
                ? (sqlErrorMarkers(line, source.text, source.base, kind)[0] ??
                  impactCallMarkers(line, source.text).map((finding) => ({
                    ...finding,
                    start: finding.start + source.base,
                    end: finding.end + source.base,
                  }))[0])
                : undefined;
              return (
                <span key={`${index}:${line}`}>
                  {marker && onReveal ? (
                    <button
                      type="button"
                      className="cursor-pointer rounded-sm text-left whitespace-pre-wrap underline decoration-muted-foreground/40 underline-offset-2 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      title="Zur Fehlerstelle im Editor springen"
                      onClick={() => onReveal(marker)}
                    >
                      {line}
                    </button>
                  ) : (
                    line
                  )}
                  {index < lines.length - 1 ? "\n" : null}
                </span>
              );
            })}
          </pre>
        </details>
      )}
    </div>
  );
}

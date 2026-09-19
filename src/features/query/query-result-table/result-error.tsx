import type { DatabaseKind } from "@/lib/db";
import { dbErrorCode } from "@/lib/db-error-codes";
import { impactCallMarkers, type SqlMarker, sqlErrorMarkers } from "@/lib/sql-diagnostics";

interface ResultErrorProps {
  error: string;
  kind?: DatabaseKind;
  source?: { text: string; base: number } | null;
  onReveal?: (marker: SqlMarker) => void;
}

export function ResultError({ error, kind, source, onReveal }: ResultErrorProps) {
  const errorCode = dbErrorCode(kind, error);
  return (
    <div className="flex h-full flex-col items-start gap-2 overflow-auto p-5">
      <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
        Fehler
      </span>
      <pre className="whitespace-pre-wrap font-mono text-sm text-destructive">
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
                  className="cursor-pointer rounded-sm text-left whitespace-pre-wrap underline decoration-destructive/40 underline-offset-2 hover:bg-destructive/10 hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
      {errorCode && (
        <p className="text-xs text-muted-foreground">
          Fehlercode <span className="font-mono font-semibold">{errorCode.code}</span> ·{" "}
          {errorCode.description}
        </p>
      )}
    </div>
  );
}

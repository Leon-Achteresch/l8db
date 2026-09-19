import type { DatabaseKind } from "@/lib/db";
import { dbErrorCode } from "@/lib/db-error-codes";

interface ResultErrorProps {
  error: string;
  kind?: DatabaseKind;
}

export function ResultError({ error, kind }: ResultErrorProps) {
  const errorCode = dbErrorCode(kind, error);
  return (
    <div className="flex h-full flex-col items-start gap-2 overflow-auto p-5">
      <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
        Fehler
      </span>
      <pre className="whitespace-pre-wrap font-mono text-sm text-destructive">{error}</pre>
      {errorCode && (
        <p className="text-xs text-muted-foreground">
          Fehlercode <span className="font-mono font-semibold">{errorCode.code}</span> ·{" "}
          {errorCode.description}
        </p>
      )}
    </div>
  );
}

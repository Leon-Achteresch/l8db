import { Check, Copy, RefreshCw, TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { FallbackProps } from "react-error-boundary";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { errorMessageOf, errorStackOf, isChunkFailure } from "@/lib/error-details";
import { cn } from "@/lib/utils";

export function PanelErrorFallback({
  error,
  resetErrorBoundary,
  label,
  compact = false,
  className,
}: FallbackProps & { label: string; compact?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false);
  const message = errorMessageOf(error);
  const chunkFailure = isChunkFailure(message);

  async function copyDetails() {
    try {
      await copyText([message, errorStackOf(error)].filter(Boolean).join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        "grid h-full min-h-0 w-full place-items-center overflow-auto text-center",
        compact ? "p-2" : "p-6",
        className,
      )}
    >
      <div className={cn("flex max-w-sm flex-col items-center", compact ? "gap-1.5" : "gap-3")}>
        <div
          className={cn(
            "grid shrink-0 place-items-center rounded-xl border bg-destructive/10 text-destructive",
            compact ? "size-7" : "size-10",
          )}
        >
          <TriangleAlert className={compact ? "size-3.5" : "size-5"} />
        </div>
        <p className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{label} ist abgestürzt</p>
        {!compact && (
          <p className="line-clamp-3 font-mono text-xs break-words text-muted-foreground">
            {message || "Unbekannter Fehler"}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <Button
            size="xs"
            onClick={() => (chunkFailure ? window.location.reload() : resetErrorBoundary())}
          >
            <RefreshCw data-icon="inline-start" />
            {chunkFailure ? "Neu laden" : "Erneut versuchen"}
          </Button>
          {!compact && (
            <Button size="xs" variant="ghost" onClick={copyDetails}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Kopiert" : "Details kopieren"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

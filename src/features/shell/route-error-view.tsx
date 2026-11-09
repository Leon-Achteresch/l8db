import { Link } from "@tanstack/react-router";
import { Check, Copy } from "lucide";
import { ArrowLeft, ChevronRight, House, RefreshCw } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { reportCrash } from "@/lib/crash-reporting";
import { recordDiagnosticError } from "@/lib/diagnostics";
import { errorMessageOf, errorStackOf, isChunkFailure } from "@/lib/error-details";
import { cn } from "@/lib/utils";

interface RouteErrorViewProps {
  error: unknown;
  reset: () => void;
}

export function RouteErrorView({ error, reset }: RouteErrorViewProps) {
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const message = errorMessageOf(error);
  const stack = errorStackOf(error);
  const chunkFailure = useMemo(() => isChunkFailure(message), [message]);

  useEffect(() => {
    recordDiagnosticError("route.error", message);
    if (!isChunkFailure(message)) reportCrash(error);
  }, [message, error]);

  async function copyDetails() {
    const payload = [message, stack].filter(Boolean).join("\n\n");
    try {
      await copyText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  function retry() {
    if (chunkFailure) {
      window.location.reload();
      return;
    }
    reset();
  }

  return (
    <div className="grid min-h-0 w-full flex-1 place-items-center overflow-y-auto p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-md"
      >
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          <span
            className={cn(
              "size-1.5 rounded-full",
              chunkFailure ? "bg-amber-500" : "bg-destructive",
            )}
          />
          {chunkFailure ? "CHUNK_504" : "ROUTE_ERROR"}
        </div>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">
          {chunkFailure ? "Ansicht konnte nicht geladen werden" : "Diese Ansicht ist abgestürzt"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {chunkFailure
            ? "Veralteter Cache, Neuladen behebt das."
            : "Verbindungen und Tabs bleiben erhalten."}
        </p>

        <div className="mt-5 overflow-hidden rounded-xl bg-muted/40">
          <div className="flex items-start gap-1 p-1">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-label="Fehlerdetails"
              className="flex min-w-0 flex-1 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-xs leading-relaxed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight
                className={cn(
                  "mt-0.5 size-3.5 shrink-0 transition-transform duration-200",
                  detailsOpen && "rotate-90",
                )}
              />
              <span className="min-w-0 break-words">{message || "Unbekannter Fehler"}</span>
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={copyDetails}
              aria-label="Details kopieren"
              title="Details kopieren"
              className="text-muted-foreground"
            >
              <MorphIcon icon={copied ? Check : Copy} className="size-3.5" />
            </Button>
          </div>
          {detailsOpen && (
            <pre className="max-h-56 overflow-auto px-5 pt-1 pb-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground/80">
              {stack ?? message}
            </pre>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          <Button size="sm" onClick={retry}>
            <RefreshCw data-icon="inline-start" />
            {chunkFailure ? "Seite neu laden" : "Erneut versuchen"}
          </Button>
          {chunkFailure ? (
            <Button size="sm" variant="ghost" onClick={reset}>
              <ArrowLeft data-icon="inline-start" />
              Zurück zur Route
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
              Neu laden
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <Link to="/">
              <House data-icon="inline-start" />
              Startseite
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

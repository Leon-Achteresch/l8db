import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  House,
  RefreshCw,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import { recordDiagnosticError } from "@/lib/diagnostics";
import { cn } from "@/lib/utils";

interface RouteErrorViewProps {
  error: unknown;
  reset: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function stackOf(error: unknown): string | null {
  if (error instanceof Error && typeof error.stack === "string") return error.stack;
  return null;
}

function isChunkFailure(message: string): boolean {
  return /dynamically imported module|importing a module script failed|outdated optimize dep|loading chunk|chunkloaderror|failed to fetch|504/i.test(
    message,
  );
}

export function RouteErrorView({ error, reset }: RouteErrorViewProps) {
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const message = messageOf(error);
  const stack = stackOf(error);
  const chunkFailure = useMemo(() => isChunkFailure(message), [message]);

  useEffect(() => {
    recordDiagnosticError("route.error", message);
  }, [message]);

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

  const Icon = chunkFailure ? WifiOff : TriangleAlert;

  return (
    <div className="connection-empty relative grid min-h-0 w-full flex-1 place-items-center overflow-y-auto p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 left-1/4 h-56 w-96 rounded-full bg-destructive/10 blur-3xl"
      />
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="shell-bezel relative w-full max-w-lg p-8"
      >
        <div className="flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl border bg-destructive/10 text-destructive">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={chunkFailure ? "secondary" : "destructive"}>
                {chunkFailure ? "Modul-Ladefehler" : "Unerwarteter Fehler"}
              </Badge>
              <span className="font-mono text-[11px] text-muted-foreground">
                {chunkFailure ? "CHUNK_504" : "ROUTE_ERROR"}
              </span>
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
              {chunkFailure ? "Ansicht konnte nicht geladen werden" : "Etwas ist schiefgelaufen"}
            </h1>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {chunkFailure
            ? "Ein Code-Modul (z. B. Tabelle oder Virtualisierung) wurde beim Laden ungültig – typischerweise ein veralteter Dev-Cache nach „Outdated Optimize Dep“. Ein Neuladen behebt das in der Regel sofort."
            : "Diese Ansicht ist abgestürzt. Du kannst es erneut versuchen oder zur Startseite zurückkehren – deine Verbindungen und Tabs bleiben erhalten."}
        </p>

        <div className="mt-4 rounded-xl border bg-muted/50 px-3.5 py-3 font-mono text-xs leading-relaxed break-words text-muted-foreground">
          {message || "Unbekannter Fehler"}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <Button onClick={retry} className="gap-1.5">
            <RefreshCw className="size-4" />
            {chunkFailure ? "Seite neu laden" : "Erneut versuchen"}
          </Button>
          {!chunkFailure && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              Neu laden
            </Button>
          )}
          <Button variant="ghost" asChild>
            <Link to="/">
              <House className="size-4" data-icon="inline-start" />
              Startseite
            </Link>
          </Button>
        </div>

        <div className="mt-6 border-t pt-4">
          <button
            type="button"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
            className="flex w-full items-center justify-between text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>Fehlerdetails</span>
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                detailsOpen && "rotate-180",
              )}
            />
          </button>
          {detailsOpen && (
            <div className="mt-3 space-y-3">
              <pre className="max-h-48 overflow-auto rounded-lg border bg-background p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {stack ?? message}
              </pre>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={copyDetails}>
                  {copied ? (
                    <Check className="size-3.5" data-icon="inline-start" />
                  ) : (
                    <Copy className="size-3.5" data-icon="inline-start" />
                  )}
                  {copied ? "Kopiert" : "Details kopieren"}
                </Button>
                <Button size="sm" variant="ghost" onClick={reset}>
                  <ArrowLeft className="size-3.5" data-icon="inline-start" />
                  Zurück zur Route
                </Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

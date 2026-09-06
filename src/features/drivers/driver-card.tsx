import { Copy, Download, ExternalLink, RefreshCw } from "lucide-react";
import { motion } from "motion/react";

import { DriverDetail } from "@/components/driver-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { DatabaseKind } from "@/lib/db";
import type { DriverSummary } from "@/lib/drivers";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  summary: DriverSummary;
  installing: boolean;
  busy: boolean;
  log?: string;
  onInstall: (kind: DatabaseKind) => void;
  onRecheck: (kind: DatabaseKind) => void;
}

export function DriverCard({ summary, installing, busy, log, onInstall, onRecheck }: Props) {
  const available = summary.status.available;
  const command = summary.installCommand ?? summary.hint?.command;
  return (
    <motion.section
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{summary.title}</h2>
        <Badge variant="secondary">{summary.typeLabel}</Badge>
        <Badge variant={available ? "default" : "destructive"}>
          {available ? "Bereit" : "Fehlt"}
        </Badge>
        <span className="ml-auto text-xs text-muted-foreground">
          {summary.providers.length} {summary.providers.length === 1 ? "Anbieter" : "Anbieter"}
        </span>
      </div>

      <DriverDetail
        detail={summary.status.detail}
        className="mt-2 block text-xs leading-relaxed text-muted-foreground"
      />

      <div className="mt-2 flex flex-wrap gap-1.5">
        {summary.providers.map((provider) => (
          <span
            key={provider.id}
            className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
          >
            {provider.name}
          </span>
        ))}
      </div>

      {!available && command && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="w-14 shrink-0 font-medium text-muted-foreground">
            {summary.hint?.os ?? "Setup"}
          </span>
          <code className="min-w-0 flex-1 truncate rounded bg-black/5 px-1.5 py-0.5 font-mono dark:bg-white/10">
            {command}
          </code>
          <button
            type="button"
            aria-label="Befehl kopieren"
            className="cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={() => void navigator.clipboard.writeText(command)}
          >
            <Copy className="size-3.5" />
          </button>
          {summary.hint && (
            <a
              href={summary.hint.url}
              target="_blank"
              rel="noreferrer"
              aria-label="Dokumentation öffnen"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      )}

      {log && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">Protokoll</span>
            <button
              type="button"
              aria-label="Protokoll kopieren"
              title="Protokoll kopieren"
              className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground"
              onClick={() => void navigator.clipboard.writeText(log)}
            >
              <Copy className="size-3" />
              Kopieren
            </button>
          </div>
          <pre className="max-h-40 overflow-auto rounded-md bg-black/5 p-2 font-mono text-[11px] whitespace-pre-wrap dark:bg-white/10">
            {log}
          </pre>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {summary.installable && (
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => onInstall(summary.kind)}
          >
            {installing ? <Spinner className="size-3" /> : <Download className="size-3" />}
            {installing ? "Installieren …" : "Installieren"}
          </Button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onRecheck(summary.kind)}
          className={cn(
            "inline-flex items-center gap-1 text-xs text-muted-foreground underline cursor-pointer",
            "hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <RefreshCw className="size-3" />
          Erneut prüfen
        </button>
      </div>
    </motion.section>
  );
}

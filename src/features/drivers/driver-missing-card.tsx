import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { InstallButton } from "@/features/drivers/install-button";
import { InstallCommand } from "@/features/drivers/install-command";
import { copyText } from "@/lib/clipboard";
import type { DriverSummary } from "@/lib/drivers";

interface Props {
  summary: DriverSummary;
  installing: boolean;
  busy: boolean;
  log?: string;
  onInstall: () => void;
  onRecheck: () => void;
}

export function DriverMissingCard({ summary, installing, busy, log, onInstall, onRecheck }: Props) {
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl bg-card p-4 ring-1 ring-amber-500/30">
      <div className="flex items-center gap-3">
        <ProviderLogo kind={summary.kind} className="size-7" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{summary.title}</h3>
          <p
            className="truncate text-xs text-muted-foreground"
            title={summary.providers.map((provider) => provider.name).join(", ")}
          >
            {summary.providers.map((provider) => provider.name).join(", ")}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-label={`${summary.title} erneut prüfen`}
          title="Erneut prüfen"
          onClick={onRecheck}
          className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95 disabled:pointer-events-none disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" />
        </button>
        {summary.hint && (
          <a
            href={summary.hint.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Anleitung für ${summary.title} öffnen`}
            title="Anleitung öffnen"
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ExternalLink className="size-3.5" />
          </a>
        )}
      </div>
      <p
        className="line-clamp-3 text-xs leading-5 text-muted-foreground"
        title={summary.status.detail}
      >
        {summary.status.detail}
      </p>
      {log && (
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-medium">Protokoll</span>
            <button
              type="button"
              aria-label="Protokoll kopieren"
              className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground focus-visible:underline focus-visible:outline-none"
              onClick={() => void copyText(log)}
            >
              <Copy className="size-3" />
              Kopieren
            </button>
          </div>
          <pre className="max-h-40 overflow-auto rounded-lg bg-muted/70 p-2 font-mono text-[11px] whitespace-pre-wrap">
            {log}
          </pre>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <InstallCommand summary={summary} className="w-full sm:w-auto sm:flex-1" />
        {summary.installable && (
          <InstallButton
            installing={installing}
            disabled={busy}
            onClick={onInstall}
            className="h-9"
          />
        )}
      </div>
    </article>
  );
}

import { CircleCheck, ExternalLink } from "lucide-react";
import { Tooltip } from "@/components/motion/tooltip";
import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { InstallButton } from "./install-button";
import { InstallCommand } from "./install-command";
import type { DriverVariantProps } from "./types";

export function DriverHealthVariant({ summaries, installing, onInstall }: DriverVariantProps) {
  const missing = summaries.filter((summary) => !summary.status.available);
  const ready = summaries.filter((summary) => summary.status.available);

  return (
    <div className="space-y-7">
      <section aria-label="Zustand aller Treiber" className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-base font-medium">
            {missing.length
              ? `${missing.length} von ${summaries.length} Treibern ${missing.length === 1 ? "fehlt" : "fehlen"}`
              : "Alle Treiber sind einsatzbereit"}
          </p>
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-emerald-500" />
              Bereit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-sm bg-amber-500" />
              Fehlt
            </span>
          </span>
        </div>
        <ul className="flex gap-1">
          {summaries.map((summary) => (
            <li key={summary.kind} className="min-w-0 flex-1">
              <Tooltip
                wrapperClassName="block"
                content={`${summary.title}: ${summary.status.available ? "bereit" : "fehlt"}`}
              >
                <span
                  role="img"
                  aria-label={`${summary.title}: ${summary.status.available ? "bereit" : "fehlt"}`}
                  className={cn(
                    "flex h-12 flex-col items-center justify-center gap-1.5 rounded-md",
                    summary.status.available ? "bg-emerald-500/10" : "bg-amber-500/15",
                  )}
                >
                  <ProviderLogo
                    kind={summary.kind}
                    className={cn("size-4", !summary.status.available && "opacity-60 grayscale")}
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "h-0.5 w-3/5 rounded-full",
                      summary.status.available ? "bg-emerald-500/70" : "bg-amber-500",
                    )}
                  />
                </span>
              </Tooltip>
            </li>
          ))}
        </ul>
      </section>

      {missing.length > 0 ? (
        <section aria-labelledby="health-missing" className="space-y-3">
          <h4 id="health-missing" className="text-sm font-semibold">
            Braucht deine Aufmerksamkeit
          </h4>
          <div className="grid gap-3 lg:grid-cols-2">
            {missing.map((summary) => (
              <article
                key={summary.kind}
                className="flex min-w-0 flex-col gap-3 rounded-xl bg-background p-4 ring-1 ring-amber-500/30"
              >
                <div className="flex items-center gap-3">
                  <ProviderLogo kind={summary.kind} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{summary.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {summary.providers.map((provider) => provider.name).join(", ")}
                    </p>
                  </div>
                  {summary.hint && (
                    <a
                      href={summary.hint.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Anleitung für ${summary.title} öffnen`}
                      className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  )}
                </div>
                <p
                  className="line-clamp-2 text-xs leading-5 text-muted-foreground"
                  title={summary.status.detail}
                >
                  {summary.status.detail}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <InstallCommand summary={summary} className="w-full sm:w-auto sm:flex-1" />
                  {summary.installable && (
                    <InstallButton
                      installing={installing === summary.kind}
                      disabled={installing !== null}
                      onClick={() => onInstall(summary.kind)}
                      className="h-9"
                    />
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-emerald-500" />
          Du kannst jede unterstützte Datenbank direkt verbinden.
        </p>
      )}

      {ready.length > 0 && (
        <section aria-labelledby="health-ready" className="space-y-3">
          <h4 id="health-ready" className="text-sm font-semibold">
            Einsatzbereit
          </h4>
          <ul className="flex flex-wrap gap-1.5">
            {ready.map((summary) => (
              <li
                key={summary.kind}
                title={summary.providers.map((provider) => provider.name).join(", ")}
                className="inline-flex h-8 items-center gap-2 rounded-full bg-background pr-3 pl-2 text-xs ring-1 ring-border"
              >
                <ProviderLogo kind={summary.kind} className="size-4" />
                {summary.title}
                <span className="tabular-nums text-muted-foreground">
                  {summary.providers.length}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

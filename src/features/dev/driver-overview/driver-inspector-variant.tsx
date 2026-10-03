import { ExternalLink, RefreshCw } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { InstallButton } from "./install-button";
import { InstallCommand } from "./install-command";
import { type DriverVariantProps, missingFirst } from "./types";

const OS_LABELS: Record<string, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
  all: "allen Systemen",
};

export function DriverInspectorVariant({
  summaries,
  installing,
  onInstall,
  onRecheck,
}: DriverVariantProps) {
  const ordered = missingFirst(summaries);
  const [selected, setSelected] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const active = ordered.find((summary) => summary.kind === selected) ?? ordered[0];
  if (!active) return null;
  const available = active.status.available;

  return (
    <div className="grid overflow-hidden rounded-xl border bg-background md:grid-cols-[15rem_minmax(0,1fr)]">
      <nav
        aria-label="Treiberfamilien"
        className="max-h-80 overflow-y-auto border-b p-1.5 md:max-h-[30rem] md:border-r md:border-b-0"
      >
        {ordered.map((summary) => (
          <button
            key={summary.kind}
            type="button"
            aria-current={summary.kind === active.kind}
            onClick={() => setSelected(summary.kind)}
            className={cn(
              "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 text-left text-sm text-muted-foreground transition-colors duration-150 hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              summary.kind === active.kind && "bg-muted text-foreground",
            )}
          >
            <ProviderLogo kind={summary.kind} className="size-4" />
            <span className="min-w-0 flex-1 truncate" title={summary.title}>
              {summary.title}
            </span>
            {!summary.status.available && (
              <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                Fehlt
              </span>
            )}
          </button>
        ))}
      </nav>
      <motion.article
        key={active.kind}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(3px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.16, ease: EASE_OUT }}
        className="min-w-0 p-5 md:p-7"
      >
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-muted/60 ring-1 ring-border/60 ring-inset">
            <ProviderLogo kind={active.kind} className="size-9" />
          </span>
          <div className="min-w-0">
            <h4 className="text-xl font-semibold tracking-tight text-balance">{active.title}</h4>
            <p className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
              <span
                aria-hidden
                className={cn("size-2 rounded-full", available ? "bg-emerald-500" : "bg-amber-500")}
              />
              {available ? "Einsatzbereit" : "Nicht installiert"}
              <span aria-hidden className="text-border">
                /
              </span>
              {active.typeLabel}
            </p>
          </div>
        </div>
        <p className="mt-5 max-w-prose text-sm leading-6 text-muted-foreground">
          {active.status.detail}
        </p>

        {!available && (
          <div className="mt-6 space-y-2">
            <h5 className="text-sm font-medium">
              Einrichten
              {active.hint ? ` unter ${OS_LABELS[active.hint.os] ?? active.hint.os}` : ""}
            </h5>
            <div className="flex flex-wrap items-center gap-2">
              <InstallCommand summary={active} className="w-full sm:w-auto sm:flex-1" />
              {active.installable && (
                <InstallButton
                  installing={installing === active.kind}
                  disabled={installing !== null}
                  onClick={() => onInstall(active.kind)}
                  className="h-9"
                />
              )}
            </div>
          </div>
        )}

        <h5 className="mt-7 text-sm font-medium">
          Nutzt diesen Treiber
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">
            {active.providers.length}
          </span>
        </h5>
        <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-1">
          {active.providers.map((provider) => (
            <li
              key={provider.id}
              className="flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-2 text-sm"
            >
              <ProviderLogo providerId={provider.id} kind={provider.kind} className="size-4" />
              <span className="truncate" title={provider.name}>
                {provider.name}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-4 border-t pt-4 text-xs">
          <button
            type="button"
            onClick={() => onRecheck(active.kind)}
            className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none"
          >
            <RefreshCw className="size-3.5" />
            Erneut prüfen
          </button>
          {active.hint && (
            <a
              href={active.hint.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none"
            >
              <ExternalLink className="size-3.5" />
              Anleitung öffnen
            </a>
          )}
        </div>
      </motion.article>
    </div>
  );
}

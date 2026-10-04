import { ExternalLink, RefreshCw, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { InstallButton } from "@/features/drivers/install-button";
import { InstallCommand } from "@/features/drivers/install-command";
import { EASE_OUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import type { DriverVariantProps } from "./types";

export function DriverMosaicVariant({
  summaries,
  installing,
  onInstall,
  onRecheck,
}: DriverVariantProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const active = summaries.find((summary) => summary.kind === selected);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2">
        {summaries.map((summary) => {
          const available = summary.status.available;
          const isSelected = summary.kind === selected;
          return (
            <button
              key={summary.kind}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(isSelected ? null : summary.kind)}
              className={cn(
                "group relative flex aspect-[5/4] cursor-pointer flex-col items-start justify-between rounded-xl bg-background p-3 text-left ring-1 ring-border transition-[transform,box-shadow] duration-150 hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.98]",
                isSelected && "ring-2 ring-foreground hover:ring-foreground",
              )}
            >
              <ProviderLogo
                kind={summary.kind}
                className={cn(
                  "size-8 transition-[filter,opacity] duration-200",
                  !available && "opacity-45 grayscale group-hover:opacity-70",
                )}
              />
              {!available && (
                <span className="absolute top-2.5 right-2.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  Fehlt
                </span>
              )}
              <span className="w-full min-w-0">
                <span className="block truncate text-sm font-medium" title={summary.title}>
                  {summary.title}
                </span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {summary.providers.length} Anbieter
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {active && (
          <motion.section
            key={active.kind}
            aria-label={`${active.title} Details`}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)" }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.22, ease: EASE_OUT }}
            className="rounded-xl bg-background p-4 ring-1 ring-border"
          >
            <div className="flex items-start gap-3">
              <ProviderLogo kind={active.kind} className="size-10" />
              <div className="min-w-0 flex-1">
                <h4 className="text-base font-semibold">{active.title}</h4>
                <p className="text-xs text-muted-foreground">
                  {active.typeLabel} ·{" "}
                  {active.status.available ? "einsatzbereit" : "nicht installiert"}
                </p>
              </div>
              <button
                type="button"
                aria-label="Details schließen"
                onClick={() => setSelected(null)}
                className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-3 max-w-prose text-sm leading-6 text-muted-foreground">
              {active.status.detail}
            </p>
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {active.providers.map((provider) => (
                <li
                  key={provider.id}
                  className="inline-flex h-8 items-center gap-2 rounded-full bg-muted/70 pr-3 pl-2 text-xs"
                >
                  <ProviderLogo providerId={provider.id} kind={provider.kind} className="size-4" />
                  {provider.name}
                </li>
              ))}
            </ul>
            {!active.status.available && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
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
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
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
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

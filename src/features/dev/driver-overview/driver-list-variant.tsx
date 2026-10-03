import { RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { InstallButton } from "./install-button";
import { InstallCommand } from "./install-command";
import { type DriverVariantProps, distinctLogos, missingFirst } from "./types";

const FILTERS = [
  { id: "all", label: "Alle" },
  { id: "missing", label: "Fehlt" },
  { id: "ready", label: "Bereit" },
] as const;

type Filter = (typeof FILTERS)[number]["id"];

export function DriverListVariant({
  summaries,
  installing,
  onInstall,
  onRecheck,
}: DriverVariantProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const rows = missingFirst(summaries).filter((summary) => {
    if (filter === "missing" && summary.status.available) return false;
    if (filter === "ready" && !summary.status.available) return false;
    if (!needle) return true;
    return (
      summary.title.toLowerCase().includes(needle) ||
      summary.providers.some((provider) => provider.name.toLowerCase().includes(needle))
    );
  });
  const counts: Record<Filter, number> = {
    all: summaries.length,
    missing: summaries.filter((summary) => !summary.status.available).length,
    ready: summaries.filter((summary) => summary.status.available).length,
  };

  return (
    <div className="overflow-hidden rounded-xl border bg-background">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-2.5">
        <fieldset className="flex rounded-lg bg-muted p-0.5">
          <legend className="sr-only">Treiber filtern</legend>
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                filter === id && "bg-background text-foreground shadow-xs",
              )}
            >
              {label}
              <span className="tabular-nums opacity-60">{counts[id]}</span>
            </button>
          ))}
        </fieldset>
        <label className="ml-auto flex h-8 w-full items-center gap-2 rounded-lg px-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:w-56">
          <Search className="size-3.5 shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Treiber oder Anbieter suchen"
            aria-label="Treiber oder Anbieter suchen"
            className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      <ul className="divide-y">
        {rows.map((summary) => {
          const available = summary.status.available;
          const logos = distinctLogos(summary.providers);
          const shown = logos.slice(0, 6);
          return (
            <li
              key={summary.kind}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 md:grid-cols-[auto_minmax(0,1fr)_auto_7rem_auto]"
            >
              <span className="grid size-9 place-items-center rounded-lg bg-muted/70">
                <ProviderLogo kind={summary.kind} className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" title={summary.title}>
                  {summary.title}
                </p>
                <p className="truncate text-xs text-muted-foreground" title={summary.status.detail}>
                  {available ? summary.typeLabel : summary.status.detail}
                </p>
              </div>
              <div
                className="col-start-2 row-start-2 flex items-center md:col-start-auto md:row-start-auto"
                title={summary.providers.map((provider) => provider.name).join(", ")}
              >
                {shown.map((provider) => (
                  <span
                    key={provider.id}
                    className="-ml-1.5 grid size-6 place-items-center rounded-full bg-background ring-2 ring-background first:ml-0"
                  >
                    <ProviderLogo
                      providerId={provider.id}
                      kind={provider.kind}
                      className="size-4"
                    />
                  </span>
                ))}
                {logos.length > shown.length && (
                  <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                    +{logos.length - shown.length}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "hidden items-center gap-1.5 text-xs md:inline-flex",
                  available ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    available ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                {available ? "Bereit" : "Fehlt"}
              </span>
              <div className="col-start-3 row-span-2 row-start-1 flex justify-end md:col-start-auto md:row-span-1 md:row-start-auto">
                {summary.installable ? (
                  <InstallButton
                    installing={installing === summary.kind}
                    disabled={installing !== null}
                    onClick={() => onInstall(summary.kind)}
                  />
                ) : (
                  <button
                    type="button"
                    aria-label={`${summary.title} erneut prüfen`}
                    title="Erneut prüfen"
                    onClick={() => onRecheck(summary.kind)}
                    className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95"
                  >
                    <RefreshCw className="size-3.5" />
                  </button>
                )}
              </div>
              {!available && !summary.installable && (
                <InstallCommand
                  summary={summary}
                  className="col-span-full md:col-start-2 md:col-end-6"
                />
              )}
            </li>
          );
        })}
        {!rows.length && (
          <li className="px-3 py-10 text-center text-xs text-muted-foreground">
            {filter === "missing" && !needle
              ? "Alle Treiber sind einsatzbereit."
              : "Kein Treiber passt zur Suche."}
          </li>
        )}
      </ul>
    </div>
  );
}

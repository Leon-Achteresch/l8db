import { Tooltip } from "@/components/motion/tooltip";
import { ProviderLogo } from "@/components/provider-logo";
import type { DriverSummary } from "@/lib/drivers";
import { cn } from "@/lib/utils";

export function DriverHealthBar({ summaries }: { summaries: DriverSummary[] }) {
  const missing = summaries.filter((summary) => !summary.status.available).length;
  return (
    <section aria-label="Zustand aller Treiber" className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-base font-medium">
          {missing
            ? `${missing} von ${summaries.length} Treibern ${missing === 1 ? "fehlt" : "fehlen"}`
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
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(2.25rem,1fr))] gap-1">
        {summaries.map((summary) => {
          const label = `${summary.title}: ${summary.status.available ? "bereit" : "fehlt"}`;
          return (
            <li key={summary.kind} className="min-w-0">
              <Tooltip wrapperClassName="block" content={label}>
                <span
                  role="img"
                  aria-label={label}
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
          );
        })}
      </ul>
    </section>
  );
}

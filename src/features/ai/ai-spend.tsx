import { useEffect, useMemo, useState } from "react";
import { formatAiCost, refreshAiRates, useAiCurrency } from "@/lib/ai/currency";
import { AI_SPEND_KEY, parseSpendLog, readAiSpendLog, summarizeAiSpend } from "@/lib/ai/spend";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { syncAcrossWindows } from "@/lib/window-sync";

const PERIODS = [7, 30, 90];
const compact = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });

export function AiSpend() {
  const feature = useNewFeatureVisibility<HTMLElement>("ai.usage.spend");
  const currency = useAiCurrency();
  const [days, setDays] = useState(30);
  const [log, setLog] = useState(readAiSpendLog);
  useEffect(() => syncAcrossWindows(AI_SPEND_KEY, (value) => setLog(parseSpendLog(value))), []);
  useEffect(() => {
    if (currency.code !== "USD") void refreshAiRates();
  }, [currency.code]);
  const report = useMemo(() => summarizeAiSpend(log, days), [log, days]);
  const { total } = report;
  const priced = total.cost > 0;
  const value = (entry: { cost: number; tokens: number }) => (priced ? entry.cost : entry.tokens);
  const show = (cost: number, tokens: number) =>
    priced ? `≈ ${formatAiCost(cost, currency)}` : `${compact.format(tokens)} Tokens`;
  const peak = Math.max(...report.series.map(value), 0);
  const share = Math.max(
    ...report.models.map(({ spend }) => value({ ...spend, tokens: spend.input + spend.output })),
    0,
  );
  return (
    <section ref={feature.ref} aria-label="Verbrauch" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>Verbrauch</div>
        <div className="flex rounded-full bg-muted/40 p-0.5 tabular-nums">
          {PERIODS.map((period) => (
            <button
              key={period}
              type="button"
              aria-pressed={days === period}
              aria-label={`${period} Tage`}
              onClick={() => setDays(period)}
              className={cn(
                "min-h-6 rounded-full px-2.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                days === period && "bg-background text-foreground shadow-xs",
              )}
            >
              {period} T
            </button>
          ))}
        </div>
      </div>
      {total.requests === 0 ? (
        <div className="text-muted-foreground">Keine Anfragen</div>
      ) : (
        <>
          <div className="flex items-baseline gap-2 tabular-nums">
            <span className="text-xl font-medium tracking-tight">
              {show(total.cost, total.input + total.output)}
            </span>
            <span className="truncate text-muted-foreground">
              {priced ? `${compact.format(total.input + total.output)} Tokens · ` : ""}
              {total.requests.toLocaleString("de-DE")} Anfragen
              {total.unpriced > 0 && priced ? ` · ${total.unpriced} ohne Tarif` : ""}
            </span>
          </div>
          <div role="img" aria-label="Verbrauch pro Tag" className="flex h-12 items-end gap-px">
            {report.series.map((entry) => (
              <div
                key={entry.day}
                title={`${new Date(`${entry.day}T12:00:00`).toLocaleDateString("de-DE")} · ${show(entry.cost, entry.tokens)}`}
                style={{
                  height: `${value(entry) > 0 ? Math.max(8, (value(entry) / peak) * 100) : 3}%`,
                }}
                className={cn(
                  "flex-1 rounded-[2px] bg-foreground/15 hover:bg-foreground/40",
                  value(entry) > 0 && value(entry) === peak && "bg-foreground/70",
                )}
              />
            ))}
          </div>
          <div className="space-y-2">
            {report.models.slice(0, 5).map(({ model, spend }) => {
              const tokens = spend.input + spend.output;
              return (
                <div key={model} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-3 tabular-nums">
                    <span className="truncate">{model}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {show(spend.cost, tokens)}
                    </span>
                  </div>
                  <div className="h-0.5 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground/60"
                      style={{
                        width: `${share > 0 ? (value({ cost: spend.cost, tokens }) / share) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

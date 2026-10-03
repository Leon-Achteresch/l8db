import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type AiUsageData, summarizeAiUsage } from "@/lib/ai/usage";
import type { AiMessage, AiProfile } from "@/lib/db/ai";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface Props {
  data: AiUsageData;
  profile: AiProfile;
  metadata: AiUsageData;
  messages: AiMessage[];
  prompt: string;
  onSettings: () => void;
}
export function AiUsage({ data, profile, metadata, messages, prompt, onSettings }: Props) {
  const feature = useNewFeatureVisibility<HTMLElement>("ai.usage");
  const usage = summarizeAiUsage(data, profile, metadata, messages, prompt);
  const count = (value: number) => value.toLocaleString("de-DE");
  const price = (value: number) =>
    new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: usage.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 5,
    }).format(value);
  const percent = Math.min(100, (usage.context / usage.contextLimit) * 100);
  return (
    <section
      ref={feature.ref}
      aria-label="Kontext, Tokens und Kosten"
      className="mt-1 flex justify-end text-[10px] text-muted-foreground"
    >
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Nutzungsdetails anzeigen"
            className="flex min-h-7 items-center gap-2 rounded-md px-1.5 tabular-nums hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden="true">
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  fill="none"
                  strokeWidth="2.5"
                  className="stroke-muted"
                />
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  fill="none"
                  strokeWidth="2.5"
                  pathLength="100"
                  strokeDasharray={`${percent} 100`}
                  strokeLinecap={percent > 0 ? "round" : "butt"}
                  className={
                    percent >= 90
                      ? "stroke-destructive"
                      : percent >= 70
                        ? "stroke-amber-500"
                        : "stroke-foreground/70"
                  }
                />
              </svg>
              {usage.contextEstimated ? "≈" : ""}
              {Math.round(percent)}%
            </span>
            <span className="text-border">·</span>
            <span>
              {usage.cost === null
                ? "Kosten —"
                : `${usage.costReported ? "" : "≈ "}${price(usage.cost)}`}
            </span>
            <ChevronDown className="size-2.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          className="max-h-[min(70vh,calc(var(--radix-popover-content-available-height,100vh)-16px))] w-80 overflow-y-auto overscroll-contain rounded-xl text-xs"
          aria-label="Nutzungsdetails"
        >
          <div className="flex items-center justify-between font-medium">
            <span>Kontext &amp; Kosten</span>
            <span>{usage.scope}</span>
          </div>
          <div className="grid grid-cols-2 gap-y-2 tabular-nums">
            <span className="text-muted-foreground">Kontext</span>
            <span className="text-right">
              {usage.contextEstimated ? "≈ " : ""}
              {count(usage.context)}
              {` / ${count(usage.contextLimit)}`}
            </span>
            <span className="text-muted-foreground">Eingabe / Ausgabe</span>
            <span className="text-right">
              {count(usage.input)} / {count(usage.output)}
            </span>
            {usage.cached > 0 && (
              <>
                <span className="text-muted-foreground">Cache</span>
                <span className="text-right">{count(usage.cached)}</span>
              </>
            )}
            <span className="text-muted-foreground">Kosten</span>
            <span className="text-right">
              {usage.cost === null
                ? "Tarif nicht bekannt"
                : `${usage.costReported ? "" : "≈ "}${price(usage.cost)}${usage.costUpper !== null ? `–${price(usage.costUpper)}` : ""}`}
            </span>
          </div>
          <details>
            <summary className="min-h-7 cursor-pointer py-1 text-muted-foreground">
              Berechnung &amp; weitere Details
            </summary>
            <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                {count(usage.total)} Tokens{usage.model ? ` · ${usage.model}` : ""}
              </p>
              {usage.written > 0 && <p>Cache geschrieben: {count(usage.written)}</p>}
              {usage.reasoning > 0 && (
                <p>Reasoning: {count(usage.reasoning)} · in Ausgabe enthalten</p>
              )}
              {usage.contextEstimated && (
                <p>
                  Kontext aus sichtbarer Textlänge geschätzt (4 Zeichen/Token). Zusätzlicher Tool-
                  und Skill-Kontext ist nicht enthalten.
                </p>
              )}
              <p>
                {usage.costReported
                  ? "Native Kostenmeldung; Abonnements und Rechnungen können abweichen."
                  : `${usage.custom ? "Eigener Tarif" : "API-Standardtarif, Stand 02.10.2026"}. Ohne weitere Tool-, Speicher- und Abonnementgebühren.`}
              </p>
              {usage.source && !usage.custom && (
                <a
                  href={usage.source}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block py-1 underline underline-offset-2"
                >
                  Preisquelle
                </a>
              )}
            </div>
          </details>
          <button
            type="button"
            onClick={onSettings}
            className="min-h-8 rounded-md bg-muted/40 px-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Tarif &amp; Kontextlimit einstellen
          </button>
        </PopoverContent>
      </Popover>
    </section>
  );
}

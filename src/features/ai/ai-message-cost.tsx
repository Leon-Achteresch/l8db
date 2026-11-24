import { formatAiCost, useAiCurrency } from "@/lib/ai/currency";
import type { AiSpend } from "@/lib/ai/spend";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const compact = new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 });

export function AiMessageCost({ spend }: { spend?: AiSpend }) {
  const feature = useNewFeatureVisibility<HTMLSpanElement>("ai.chat.message-cost");
  const currency = useAiCurrency();
  if (!spend) return null;
  const count = (value: number) => value.toLocaleString("de-DE");
  return (
    <span
      ref={feature.ref}
      title={`Eingabe ${count(spend.input)} · Ausgabe ${count(spend.output)}${spend.cached ? ` · Cache ${count(spend.cached)}` : ""}`}
      className="px-1 text-xs text-muted-foreground tabular-nums"
    >
      {compact.format(spend.input + spend.output)} Tokens
      {spend.unpriced ? "" : ` · ≈ ${formatAiCost(spend.cost, currency)}`}
    </span>
  );
}

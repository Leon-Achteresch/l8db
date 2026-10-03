import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { aiSuggestions } from "@/lib/ai/prompts";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useTablesQuery } from "@/lib/queries/schema-queries";

export function AiSuggestions({ onAsk }: { onAsk: (question: string) => void }) {
  const tables = useTablesQuery();
  const feature = useNewFeatureVisibility<HTMLElement>("ai.chat.suggestions");
  const questions = useMemo(
    () => aiSuggestions((tables.data ?? []).map((table) => table.name)),
    [tables.data],
  );
  return (
    <section ref={feature.ref} className="mt-6" aria-label="Beispielfragen">
      <h3 className="mb-2 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
        Zum Beispiel
        {feature.isNew && <NewBadge />}
      </h3>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onAsk(question)}
            className="group/suggestion flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-[13px] text-foreground/85 outline-none transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <span className="min-w-0 flex-1">{question}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 transition-[color,transform] duration-200 group-hover/suggestion:translate-x-0.5 group-hover/suggestion:text-foreground" />
          </button>
        ))}
      </div>
    </section>
  );
}

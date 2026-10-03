import { MessageCircleQuestion } from "lucide-react";
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
    <section ref={feature.ref} className="mt-4 space-y-1.5" aria-label="Beispielfragen">
      <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        Zum Beispiel
        {feature.isNew && <NewBadge />}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            onClick={() => onAsk(question)}
            className="flex items-start gap-2 rounded-xl border bg-background px-3 py-2 text-left text-xs text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0">{question}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

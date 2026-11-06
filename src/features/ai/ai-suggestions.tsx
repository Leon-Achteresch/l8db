import { ArrowUpRight } from "lucide-react";
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
    <section ref={feature.ref} className="mt-4 flex flex-col gap-1.5" aria-label="Beispielfragen">
      {feature.isNew && <NewBadge className="self-start" />}
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="group/suggestion flex w-full items-center gap-3 rounded-xl bg-muted/55 px-3.5 py-2.5 text-left text-[13px] leading-snug text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1">{question}</span>
          <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/suggestion:opacity-100 group-focus-visible/suggestion:opacity-100" />
        </button>
      ))}
    </section>
  );
}

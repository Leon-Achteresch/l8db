import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { NewBadge } from "@/components/new-badge";
import { GlideMenu } from "@/components/primitives/glide-menu";
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
      <GlideMenu className="-mx-1 flex flex-col gap-px">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            data-menu-row
            onClick={() => onAsk(question)}
            className="group/suggestion relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[13px] text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1">{question}</span>
            <ArrowRight className="size-3.5 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-[opacity,transform] duration-200 group-hover/suggestion:translate-x-0 group-hover/suggestion:opacity-100 group-focus-visible/suggestion:translate-x-0 group-focus-visible/suggestion:opacity-100" />
          </button>
        ))}
      </GlideMenu>
    </section>
  );
}

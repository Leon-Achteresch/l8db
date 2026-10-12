import { Sparkles } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { maskQueryResult } from "@/features/query/query-result-masking";
import { resultDraft } from "@/lib/ai/editor/chat-prompts";
import { compactResult } from "@/lib/ai/editor/compact";
import { useEditorAiSettings } from "@/lib/ai/editor/settings";
import { useAiStore } from "@/lib/ai/store";
import type { QueryResult } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useActiveMasks } from "@/lib/masking-display";

export function ResultAskAiButton({ result, sql }: { result: QueryResult; sql?: string }) {
  const { active } = useActiveMasks(result.columns);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.result.ask-ai");
  const send = () => {
    const shareValues = useEditorAiSettings.getState().shareValues;
    const masked = maskQueryResult(result, active) ?? result;
    const summary = compactResult(
      { columns: masked.columns, rows: masked.rows, truncated: masked.truncated },
      { includeValues: shareValues },
    );
    useAiStore.getState().draft(resultDraft(summary, sql));
  };
  return (
    <Button
      ref={feature.ref}
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs"
      title="Ergebnis kompakt in den KI-Chat übernehmen"
      onClick={send}
    >
      <Sparkles className="size-3" />
      <span className="hidden sm:inline">KI fragen</span>
      {feature.isNew && <NewBadge />}
    </Button>
  );
}

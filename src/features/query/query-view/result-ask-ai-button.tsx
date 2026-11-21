import { Sparkles } from "lucide-react";
import { IconMenuItem } from "@/components/icon-menu/icon-menu-item";
import { NewBadge } from "@/components/new-badge";
import { maskQueryResult } from "@/features/query/query-result-masking";
import { useAiEnabled } from "@/lib/ai/access";
import { resultDraft } from "@/lib/ai/editor/chat-prompts";
import { compactResult } from "@/lib/ai/editor/compact";
import { useEditorAiSettings } from "@/lib/ai/editor/settings";
import { useAiStore } from "@/lib/ai/store";
import type { QueryResult } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useActiveMasks } from "@/lib/masking-display";

export function ResultAskAiButton({ result, sql }: { result: QueryResult; sql?: string }) {
  const { active } = useActiveMasks(result.columns);
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.result.ask-ai");
  const enabled = useAiEnabled();
  const send = () => {
    const shareValues = useEditorAiSettings.getState().shareValues;
    const masked = maskQueryResult(result, active) ?? result;
    const summary = compactResult(
      { columns: masked.columns, rows: masked.rows, truncated: masked.truncated },
      { includeValues: shareValues },
    );
    useAiStore.getState().draft(resultDraft(summary, sql));
  };
  if (!enabled) return null;
  return (
    <IconMenuItem
      data-feature="query.result.ask-ai"
      ref={feature.ref}
      icon={<Sparkles />}
      label="KI fragen"
      onSelect={send}
    >
      {feature.isNew && <NewBadge className="absolute -right-1 -top-1" />}
    </IconMenuItem>
  );
}

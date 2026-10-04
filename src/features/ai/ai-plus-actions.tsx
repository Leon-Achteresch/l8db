import { BookOpen, Paperclip } from "lucide-react";
import { AiMenuAction as Action } from "./ai-menu-action";

export function AiPlusActions({
  connectionName,
  disabled,
  onAttach,
  onKnowledge,
}: {
  connectionName?: string;
  disabled: boolean;
  onAttach: () => void;
  onKnowledge: () => void;
}) {
  return (
    <div className="border-b p-1.5">
      <Action
        icon={<Paperclip className="size-3.5 text-muted-foreground" />}
        label="Datei anhängen"
        hint="CSV, Excel, JSON oder Parquet"
        disabled={disabled}
        onClick={onAttach}
        featureId="ai.chat.plus.attachments"
      />
      {connectionName && (
        <Action
          icon={<BookOpen className="size-3.5 text-muted-foreground" />}
          label="KI-Wissen"
          hint={`Beschreibungen und Begriffe für ${connectionName}`}
          disabled={false}
          onClick={onKnowledge}
          featureId="ai.chat.plus.knowledge"
        />
      )}
    </div>
  );
}

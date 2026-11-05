import { CornerDownRight, X } from "lucide-react";
import { IconButton } from "@/components/icon-button";

export function AiQueue({
  entries,
  onRemove,
}: {
  entries: { id: string; text: string }[];
  onRemove: (id: string) => void;
}) {
  return (
    <ul aria-label="Warteschlange" className="mb-2 space-y-1">
      {entries.map((entry) => (
        <li
          key={entry.id}
          title="Wird nach der aktuellen Antwort gesendet"
          className="flex items-center gap-2 rounded-xl bg-muted/60 py-1 pr-1 pl-3 text-xs text-foreground/85"
        >
          <CornerDownRight className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{entry.text}</span>
          <IconButton
            aria-label="Aus Warteschlange entfernen"
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => onRemove(entry.id)}
          >
            <X className="size-3" />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

import { AtSign, SquareCode, X } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import type { ChatContextItem } from "@/lib/ai/chat-context";

export function AiContextChips({
  items,
  isNew,
  disabled,
  onRemove,
}: {
  items: ChatContextItem[];
  isNew?: boolean;
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Angehängter Kontext">
      {items.map((item) => (
        <li
          key={item.id}
          title={
            item.kind === "table"
              ? `${item.schema}.${item.table}`
              : item.kind === "sql"
                ? item.sql?.slice(0, 600)
                : undefined
          }
          className="flex h-6 items-center gap-1 rounded-full bg-muted pr-0.5 pl-2 text-[11px] text-muted-foreground"
        >
          {item.kind === "tab" ? (
            <SquareCode className="size-3 shrink-0" />
          ) : (
            <AtSign className="size-3 shrink-0" />
          )}
          <span className="max-w-40 truncate text-foreground/85">
            {item.kind === "tab" ? item.label.replace(/^Editor: /, "") : item.label}
          </span>
          <button
            type="button"
            disabled={disabled}
            aria-label={`${item.label} aus Kontext entfernen`}
            onClick={() => onRemove(item.id)}
            className="grid size-5 place-items-center rounded-full hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-2.5" />
          </button>
        </li>
      ))}
      {isNew && <NewBadge />}
    </ul>
  );
}

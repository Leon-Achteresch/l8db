import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { copyText } from "@/lib/clipboard";
import type { AiKnowledge } from "@/lib/db/ai";

type TableNote = AiKnowledge["tables"][string];

function copyDescription(text: string) {
  void copyText(text, "Beschreibung kopiert").catch(() => undefined);
}

export function AiKnowledgeTable({
  table,
  note,
  disabled,
  onChange,
  onRemove,
}: {
  table: string;
  note: TableNote;
  disabled: boolean;
  onChange: (change: Partial<TableNote>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tableLabel = `Beschreibung von ${table}`;
  return (
    <details
      className="group rounded-lg border px-3 py-2"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 text-xs">
        <span className="max-w-[50%] truncate font-mono font-medium" title={table}>
          {table}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{note.description}</span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`${table} entfernen`}
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            onRemove();
          }}
        >
          <Trash2 className="size-3" />
        </Button>
      </summary>
      {expanded && (
        <fieldset className="mt-2 min-w-0 space-y-2" disabled={disabled}>
          <div className="flex items-start gap-2">
            <Textarea
              aria-label={tableLabel}
              value={note.description}
              rows={2}
              onChange={(event) => onChange({ description: event.target.value })}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${tableLabel} kopieren`}
              title="Text kopieren"
              disabled={!note.description.trim()}
              onClick={() => copyDescription(note.description)}
            >
              <Copy className="size-3.5" />
            </Button>
          </div>
          {Object.entries(note.columns).map(([column, text]) => {
            const columnLabel = `Beschreibung von ${table}.${column}`;
            return (
              <div
                key={column}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 text-xs sm:grid-cols-[9rem_minmax(0,1fr)_auto]"
              >
                <span className="col-span-2 truncate font-mono sm:col-span-1" title={column}>
                  {column}
                </span>
                <Input
                  aria-label={columnLabel}
                  value={text}
                  onChange={(event) =>
                    onChange({ columns: { ...note.columns, [column]: event.target.value } })
                  }
                />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`${columnLabel} kopieren`}
                  title="Text kopieren"
                  disabled={!text.trim()}
                  onClick={() => copyDescription(text)}
                >
                  <Copy className="size-3.5" />
                </Button>
              </div>
            );
          })}
        </fieldset>
      )}
    </details>
  );
}

import { ChevronRightIcon } from "lucide-react";
import { memo } from "react";
import { type JsonRow, parseTypedInput, stringifyJson } from "@/lib/json-editor";
import { cn } from "@/lib/utils";
import { JsonHighlight } from "./json-highlight";
import { JsonInlineInput } from "./json-inline-input";
import { JsonRowMenu } from "./json-row-menu";
import { JsonTypeIcon } from "./json-type-icon";
import { JsonValue } from "./json-value";
import type { JsonActions } from "./types";

export const JSON_ROW_HEIGHT = 26;
const INDENT = 18;

type Props = {
  row: JsonRow;
  selected: boolean;
  activeMatch: boolean;
  isMatch: boolean;
  editing: "key" | "value" | null;
  menuOpen: boolean;
  readOnly: boolean;
  query: string;
  siblingKeys: string[] | null;
  actions: JsonActions;
  onSelect: (id: string) => void;
  onToggle: (row: JsonRow) => void;
  onMenuOpenChange: (id: string | null) => void;
  onCommitKey: (row: JsonRow, key: string) => void;
  onCommitValue: (row: JsonRow, value: unknown) => void;
  onCancelEdit: () => void;
};

function indentGuides(depth: number) {
  return Array.from({ length: depth }, (_, index) => (
    <span
      key={index}
      className="relative h-full shrink-0 before:absolute before:inset-y-0 before:left-[8px] before:w-px before:bg-border/70"
      style={{ width: INDENT }}
    />
  ));
}

export const JsonTreeRow = memo(function JsonTreeRow({
  row,
  selected,
  activeMatch,
  isMatch,
  editing,
  menuOpen,
  readOnly,
  query,
  siblingKeys,
  actions,
  onSelect,
  onToggle,
  onMenuOpenChange,
  onCommitKey,
  onCommitValue,
  onCancelEdit,
}: Props) {
  if (row.closing)
    return (
      <div
        className="flex items-center pl-2 text-muted-foreground"
        style={{ height: JSON_ROW_HEIGHT }}
      >
        {indentGuides(row.depth)}
        <span className="w-4 shrink-0" />
        <span className="ml-1.5">{row.kind === "array" ? "]" : "}"}</span>
      </div>
    );

  const isRoot = row.path.length === 0;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={row.expandable ? row.expanded : undefined}
      aria-level={row.depth + 1}
      data-selected={selected}
      onClick={() => onSelect(row.id)}
      onDoubleClick={() => {
        if (readOnly) return;
        if (row.expandable) onToggle(row);
        else actions.startEdit(row.path, "value");
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect(row.id);
        onMenuOpenChange(row.id);
      }}
      className={cn(
        "group/row flex cursor-default items-center rounded-md pr-1 pl-2",
        selected ? "bg-primary/10 ring-1 ring-primary/25 ring-inset" : "hover:bg-muted/60",
        isMatch && !selected && "bg-yellow-400/8",
        activeMatch && "ring-1 ring-yellow-500/60 ring-inset",
      )}
      style={{ height: JSON_ROW_HEIGHT }}
    >
      {indentGuides(row.depth)}
      {row.expandable ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(row);
          }}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={row.expanded ? "Zuklappen" : "Aufklappen"}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform duration-150",
              row.expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <JsonTypeIcon kind={row.kind} className="mx-1" />
      {!isRoot &&
        (editing === "key" ? (
          <JsonInlineInput
            initial={String(row.key)}
            className="max-w-48 flex-none"
            validate={(text) =>
              text === ""
                ? "Schlüssel darf nicht leer sein"
                : text !== row.key && siblingKeys?.includes(text)
                  ? "Schlüssel existiert bereits"
                  : null
            }
            onCommit={(text) => onCommitKey(row, text)}
            onCancel={onCancelEdit}
          />
        ) : typeof row.key === "number" ? (
          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground tabular-nums">
            {row.key}
          </span>
        ) : (
          <span className="shrink-0 font-medium text-foreground">
            <JsonHighlight text={row.key ?? ""} query={query} />
          </span>
        ))}
      {!isRoot && <span className="mr-1.5 shrink-0 text-muted-foreground">:</span>}
      <span className="flex min-w-0 flex-1 items-center">
        {editing === "value" ? (
          <JsonInlineInput
            initial={row.kind === "string" ? (row.value as string) : stringifyJson(row.value, 0)}
            validate={(text) => {
              const parsed = parseTypedInput(text, row.kind);
              return parsed.ok ? null : parsed.error;
            }}
            onCommit={(text) => {
              const parsed = parseTypedInput(text, row.kind);
              if (parsed.ok) onCommitValue(row, parsed.value);
            }}
            onCancel={onCancelEdit}
          />
        ) : (
          <JsonValue
            row={row}
            query={query}
            readOnly={readOnly}
            onToggleBoolean={() => actions.toggleBoolean(row.path)}
            onOpenUrl={actions.openUrl}
            onUnpack={() => actions.unpack(row.path)}
          />
        )}
      </span>
      <JsonRowMenu
        row={row}
        readOnly={readOnly}
        actions={actions}
        open={menuOpen}
        onOpenChange={(open) => onMenuOpenChange(open ? row.id : null)}
      />
    </div>
  );
});

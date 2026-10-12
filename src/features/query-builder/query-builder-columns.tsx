import { XIcon } from "lucide-react";
import { QueryBuilderSection } from "@/features/query-builder/query-builder-section";
import { BASE_ALIAS, JOIN_ALIAS, type QueryBuilderState } from "@/lib/query-builder";

interface QueryBuilderColumnsProps {
  state: QueryBuilderState;
  onRemoveBase: (column: string) => void;
  onRemoveJoin: (column: string) => void;
}

export function QueryBuilderColumns({
  state,
  onRemoveBase,
  onRemoveJoin,
}: QueryBuilderColumnsProps) {
  const join = state.join;
  const chips = [
    ...state.columns.map((column) => ({
      key: `base:${column}`,
      label: join ? `${BASE_ALIAS}.${column}` : column,
      remove: () => onRemoveBase(column),
    })),
    ...(join?.columns ?? []).map((column) => ({
      key: `join:${column}`,
      label: `${JOIN_ALIAS}.${column}`,
      remove: () => onRemoveJoin(column),
    })),
  ];
  return (
    <QueryBuilderSection title="Spalten" count={chips.length}>
      <div className="flex flex-wrap gap-1.5">
        {chips.length === 0 ? (
          <span className="rounded-md border border-dashed px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {join ? `${BASE_ALIAS}.*` : "*"}
          </span>
        ) : (
          chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-md border bg-background py-0.5 pr-0.5 pl-2 font-mono text-xs"
            >
              {chip.label}
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`${chip.label} entfernen`}
                onClick={chip.remove}
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
    </QueryBuilderSection>
  );
}

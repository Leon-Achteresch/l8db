import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DatasetJoin } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { JoinEditor } from "./join-editor";
import { JoinVenn } from "./join-venn";
import type { StudioNode } from "./studio-model";

export function JoinPill({
  node,
  parent,
  parentColumns,
  columns,
  style,
  defaultOpen,
  onChange,
  onRemove,
}: {
  node: StudioNode & { join: DatasetJoin };
  parent: StudioNode;
  parentColumns: string[];
  columns: string[];
  style: React.CSSProperties;
  defaultOpen?: boolean;
  onChange: (patch: Partial<DatasetJoin>) => void;
  onRemove: () => void;
}) {
  const join = node.join;
  const kind = join.kind ?? "left";
  const extra = join.extra?.length ?? 0;
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          style={style}
          aria-label={`Verknüpfung ${parent.table} mit ${node.table} bearbeiten`}
          className={cn(
            "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border bg-background px-2 py-1 text-[10px] font-medium shadow-sm transition-[transform,box-shadow] hover:scale-105 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:border-primary data-[state=open]:text-primary",
          )}
        >
          <JoinVenn kind={kind} className="text-primary" />
          <span className="max-w-36 truncate">
            {join.fromColumn} = {join.toColumn}
          </span>
          {extra > 0 && <span className="rounded bg-muted px-1">+{extra}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="center">
        <JoinEditor
          node={node}
          parent={parent}
          parentColumns={parentColumns}
          columns={columns}
          onChange={onChange}
          onRemove={onRemove}
        />
      </PopoverContent>
    </Popover>
  );
}

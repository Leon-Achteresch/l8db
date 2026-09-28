import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, Table2 } from "lucide-react";
import { useRef } from "react";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

interface DashboardTableListProps {
  tables: { schema: string; name: string }[];
  hidden: number;
}

export function DashboardTableList({ tables, hidden }: DashboardTableListProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const count = tables.length + (hidden > 0 ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => 42,
    overscan: 4,
    initialRect: { height: 320, width: 600 },
    useFlushSync: false,
  });

  return (
    <div ref={scrollerRef} data-slot="dashboard-table-list" className="max-h-80 overflow-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const table = tables[item.index];
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className={cn(
                "absolute inset-x-0",
                item.index < count - 1 && "border-b border-border/60",
              )}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {table ? (
                <Link
                  to="/tables/$schema/$table"
                  params={{ schema: table.schema, table: table.name }}
                  onClick={() =>
                    useTableTabs.getState().openTab({ schema: table.schema, table: table.name })
                  }
                  className="group flex items-center gap-3 px-5 py-3 hover:bg-muted/60"
                >
                  <Table2 className="size-4 text-primary/80" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{table.name}</span>
                  <span className="text-[10px] text-muted-foreground">{table.schema}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
                </Link>
              ) : (
                <p className="px-5 py-3 text-[11px] text-muted-foreground">
                  … und {hidden} weitere. Suche eingrenzen oder Sidebar nutzen.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

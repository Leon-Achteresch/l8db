import { useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, LayersIcon, PlusIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useIndexesQuery } from "@/lib/queries";
import { CreateIndexDialog } from "./table-indexes-list/create-index-dialog";

interface TableIndexesListProps {
  schema: string;
  table: string;
}

export function TableIndexesList({ schema, table }: TableIndexesListProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: indexes, isLoading } = useIndexesQuery(schema, table);
  const [createOpen, setCreateOpen] = useState(false);

  const handleIndexCreated = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["indexes", connection?.id, database, schema, table],
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Indexes…
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center border-b bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Indexes</span>
        <span className="ml-2 text-xs text-muted-foreground">{indexes?.length ?? 0}</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => setCreateOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Neuer Index
        </Button>
      </div>

      {!indexes || indexes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Keine Indexes gefunden.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <section>
            <div className="divide-y">
              {indexes.map((idx) => (
                <motion.div
                  key={idx.name}
                  layout
                  transition={{ layout: SPRING_LAYOUT }}
                  className="px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      {idx.is_primary ? (
                        <KeyRoundIcon className="size-4 text-amber-500" />
                      ) : (
                        <LayersIcon
                          className={`size-4 ${idx.is_unique ? "text-blue-500" : "text-muted-foreground"}`}
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-medium font-mono text-foreground">
                          {idx.name}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {idx.index_type.toUpperCase()}
                        </Badge>
                        {idx.is_primary && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 text-amber-500 border-amber-500/20 bg-amber-500/5"
                          >
                            PRIMARY
                          </Badge>
                        )}
                        {idx.is_unique && !idx.is_primary && (
                          <Badge
                            variant="outline"
                            className="text-[10px] px-1.5 py-0 text-blue-500 border-blue-500/20 bg-blue-500/5"
                          >
                            UNIQUE
                          </Badge>
                        )}
                      </div>
                      {idx.columns.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {idx.columns.map((col) => (
                            <span
                              key={col}
                              className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                            >
                              {col}
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="font-mono text-[11px] text-muted-foreground/70 break-all">
                        {idx.definition}
                      </p>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </section>
        </div>
      )}

      <CreateIndexDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        schema={schema}
        table={table}
        onSuccess={handleIndexCreated}
      />
    </div>
  );
}

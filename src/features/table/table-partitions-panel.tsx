import { useQueryClient } from "@tanstack/react-query";
import { LayersIcon, LinkIcon, PlusIcon, UnlinkIcon } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useActiveConnection } from "@/lib/connections";
import { detachPartition } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { usePartitionInfoQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { AttachPartitionDialog } from "./table-partitions-panel/attach-partition-dialog";

interface TablePartitionsPanelProps {
  schema: string;
  table: string;
}

export function TablePartitionsPanel({ schema, table }: TablePartitionsPanelProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = usePartitionInfoQuery(schema, table);
  const [dialogOpen, setDialogOpen] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["partitions"] });
  };

  const handleDetach = async (childSchema: string, childTable: string) => {
    if (!connection) return;
    try {
      await detachPartition(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        childSchema,
        childTable,
        database ?? undefined,
      );
      toast.success(
        `Partition "${childTable}" gelöst. Die Tabelle bleibt als eigenständige Tabelle erhalten.`,
      );
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Partitionen…
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-destructive">{String(error ?? "Fehler beim Laden.")}</p>
      </div>
    );
  }

  if (!data.is_partitioned) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Keine partitionierte Tabelle (gewöhnliche {data.strategy ?? "Heap"}-Tabelle).
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <LayersIcon className="size-4 text-sky-500" />
        <span className="text-sm font-medium">{data.partitions.length} Partitionen</span>
        {data.strategy && (
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {data.strategy}
          </Badge>
        )}
        {data.partition_key && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {data.partition_key}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Partition anhängen
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {data.partitions.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            Noch keine Partitionen angelegt.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {data.partitions.map((part) => (
              <motion.div
                key={`${part.schema}.${part.name}`}
                layout
                transition={{ layout: SPRING_LAYOUT }}
                className="flex items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent/60"
              >
                <LinkIcon className="size-4 shrink-0 text-sky-500" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm">
                  {part.schema}.{part.name}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1.5 px-2.5 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => void handleDetach(part.schema, part.name)}
                  title="Partition lösen (DETACH, Tabelle bleibt erhalten)"
                >
                  <UnlinkIcon className="size-3.5" />
                  Lösen
                </Button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
      <AttachPartitionDialog
        parentSchema={schema}
        parentTable={table}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSuccess={refresh}
      />
    </div>
  );
}

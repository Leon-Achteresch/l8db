import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ServerOutputPanel } from "@/features/query/server-output-panel";
import type { SavedConnection } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { toggleServerOutput, useServerOutputStore } from "@/lib/server-output";
import { effectiveConnectionString } from "@/lib/ssh";

export function TableServerOutput({
  connection,
  database,
  open,
  onOpenChange,
}: {
  connection: SavedConnection;
  database: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.rows.server-output");
  const enabled = useServerOutputStore(
    (state) => state.enabled[connection.id] ?? connection.kind === "oracle",
  );
  const handleToggle = async (next: boolean) => {
    setBusy(true);
    try {
      await toggleServerOutput(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        next,
        database ?? undefined,
      );
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={feature.ref}
        className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-y-auto sm:max-w-3xl"
      >
        <DialogHeader>
          <DialogTitle>
            Server-Ausgabe · {connection.name}
            {database ? ` / ${database}` : ""}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="text-xs">
          Verbindung und Datenbank, nicht nur diese Tabelle. Kein Commit-Nachweis.
        </DialogDescription>
        <div className="h-80 min-h-0">
          <ServerOutputPanel
            connectionId={connection.id}
            database={database}
            enabled={enabled}
            busy={busy}
            tabs={null}
            onToggle={handleToggle}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

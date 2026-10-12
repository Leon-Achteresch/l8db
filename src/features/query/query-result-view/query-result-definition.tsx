import { CopyIcon, EyeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateViewDialog } from "@/features/query/create-view-dialog";
import { SqlEditor } from "@/features/table/sql-editor";
import { copyText } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { useCapabilities } from "@/lib/providers";
import { temporaryViewMode } from "@/lib/session-views";
import { showCopiedMessage } from "@/lib/workspace-status";

export function QueryResultDefinition({ text }: { text: string }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [dialogOpen, setDialogOpen] = useState(false);
  const viewsSupported =
    useCapabilities(connection?.kind).views || temporaryViewMode(connection?.kind) !== null;
  const canCreateView = viewsSupported && Boolean(connection && !connection.readOnly);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          Temporäre View aus der ausgeführten Abfrage
        </span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void copyText(text).then(() => showCopiedMessage("Definition kopiert"))}
          >
            <CopyIcon className="size-3.5" />
            Kopieren
          </Button>
          {canCreateView && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setDialogOpen(true)}
            >
              <EyeIcon className="size-3.5" />
              Als View speichern…
            </Button>
          )}
        </div>
      </div>
      <SqlEditor value={text} readOnly className="min-h-0 flex-1" />
      {connection && canCreateView && (
        <CreateViewDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          sql={text}
          connection={connection}
          database={database}
        />
      )}
    </div>
  );
}

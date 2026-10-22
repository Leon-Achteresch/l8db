import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { copyWithToast } from "@/lib/clipboard";
import type { ObservabilityLogRow } from "@/lib/db/supabase-studio-observability";
import { formatLogTimestamp } from "./logs-format";

export function LogsRowDetail({
  row,
  onClose,
}: {
  row: ObservabilityLogRow | null;
  onClose: () => void;
}) {
  const json = row ? JSON.stringify(row, null, 2) : "";
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Logeintrag</DialogTitle>
          <DialogDescription>
            {row ? `${formatLogTimestamp(row.timestamp)} · ${row.id}` : ""}
          </DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all">
          {json}
        </pre>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => void copyWithToast(json, "JSON")}>
            JSON kopieren
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

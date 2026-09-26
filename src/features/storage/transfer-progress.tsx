import { XIcon } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { s3CancelTransfer } from "@/lib/db";
import { transferDetail, transferPercent, useTransfers } from "@/lib/storage/transfers";

export function TransferProgress({ bucket }: { bucket: string }) {
  const all = useTransfers((state) => state.active);
  const active = Object.values(all).filter((t) => t.bucket === bucket);
  if (active.length === 0) return null;
  return (
    <div className="ml-auto flex min-w-0 flex-col gap-1">
      {active.map((transfer) => (
        <div
          key={transfer.id}
          className="flex min-w-0 items-center gap-2"
          title={transferDetail(transfer)}
        >
          <span className="shrink-0">{transfer.direction === "upload" ? "↑" : "↓"}</span>
          <span className="max-w-48 truncate">{transfer.current ?? transfer.label}</span>
          <Progress value={transferPercent(transfer)} className="h-1.5 w-28" />
          <span className="tabular-nums">{transferPercent(transfer)}%</span>
          <button
            type="button"
            aria-label="Übertragung abbrechen"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void s3CancelTransfer(transfer.id)}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

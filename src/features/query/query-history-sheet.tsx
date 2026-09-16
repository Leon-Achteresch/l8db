import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { QueryHistoryPanel } from "@/features/query/query-history-panel";

interface QueryHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
}

export function QueryHistorySheet({
  open,
  onOpenChange,
  connectionId,
  onLoad,
}: QueryHistorySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(100vw-1rem,480px)] gap-0 sm:max-w-[480px]">
        <SheetHeader className="border-b pr-12">
          <SheetTitle className="text-sm">Verlauf & Gespeichertes</SheetTitle>
          <SheetDescription className="text-xs">
            Zuletzt ausgeführte Queries und dauerhaft gespeicherte Abfragen.
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col">
          <QueryHistoryPanel
            connectionId={connectionId}
            onLoad={(sql, mode) => {
              onLoad(sql, mode);
              onOpenChange(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

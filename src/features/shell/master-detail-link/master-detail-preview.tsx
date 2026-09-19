import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MasterDetailResult } from "@/features/shell/master-detail-result";
import { ConnectionScopeContext } from "@/lib/connections";
import { MasterSelectionContext } from "@/lib/master-detail";

interface MasterDetailPreviewProps {
  previewSql: string;
  draft: string;
  source: string;
  previewId: number;
  targetConnectionId: string | null;
  setPreviewSql: (value: string | null) => void;
}

export function MasterDetailPreview({
  previewSql,
  draft,
  source,
  previewId,
  targetConnectionId,
  setPreviewSql,
}: MasterDetailPreviewProps) {
  return (
    <section
      aria-label="SQL-Vorschau"
      className="flex min-h-40 max-h-[35vh] flex-1 flex-col overflow-hidden rounded-md border"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs">
        <span className="flex-1">
          {previewSql === draft
            ? "Ergebnis für die aktuelle Master-Zeile"
            : "SQL geändert · Vorschau erneut laden"}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Vorschau schließen"
          onClick={() => setPreviewSql(null)}
        >
          <XIcon />
        </Button>
      </div>
      <ConnectionScopeContext.Provider value={targetConnectionId}>
        <MasterSelectionContext.Provider value={null}>
          <MasterDetailResult key={previewId} source={source} sql={previewSql} preview />
        </MasterSelectionContext.Provider>
      </ConnectionScopeContext.Provider>
    </section>
  );
}

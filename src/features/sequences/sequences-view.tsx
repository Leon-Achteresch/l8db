import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SearchIcon, TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveConnection } from "@/lib/connections";
import type { SequenceInfo } from "@/lib/db";
import { useSequencesQuery } from "@/lib/queries";
import { EditSequenceDialog } from "./sequences-view/edit-sequence-dialog";
import { canEditSequences } from "./sequences-view/sequence-changes";
import { SequenceRow } from "./sequences-view/sequence-row";

export function SequencesView() {
  const connection = useActiveConnection();
  const queryClient = useQueryClient();
  const { data: sequences, isLoading, isError, error } = useSequencesQuery();
  const [search, setSearch] = useState("");
  const [editingSequence, setEditingSequence] = useState<SequenceInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const editable = canEditSequences(connection?.kind);
  const q = search.trim().toLowerCase();
  const filtered = (sequences ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.schema.toLowerCase().includes(q),
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 10,
    useFlushSync: false,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden p-4 space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full bg-muted/30" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5">
          <TriangleAlertIcon className="size-8 text-destructive" />
          <p className="text-xs text-muted-foreground font-mono break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  const handleEditSuccess = async () => {
    await queryClient.invalidateQueries({ queryKey: ["sequences"] });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Sequenzen</span>
        {sequences && sequences.length > 0 && (
          <span className="text-xs text-muted-foreground">({sequences.length})</span>
        )}
      </div>

      {!sequences || sequences.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-sm text-muted-foreground">Keine Sequenzen gefunden.</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="border-b px-4 py-2">
            <div className="relative max-w-sm">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Suche…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">Keine Treffer.</p>
            ) : (
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-background border-b">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Schema
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">
                      Datentyp
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Start
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Min
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Max
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Inkrement
                    </th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-muted-foreground">
                      Zyklisch
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Letzter Wert
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                      Aktionen
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
                  {items.map(({ index }) => {
                    const seq = filtered[index];
                    return (
                      <SequenceRow
                        key={`${seq.schema}.${seq.name}`}
                        seq={seq}
                        editable={editable}
                        onEdit={setEditingSequence}
                      />
                    );
                  })}
                  {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {editable && editingSequence && (
        <EditSequenceDialog
          sequence={editingSequence}
          open={editingSequence !== null}
          onOpenChange={(open) => {
            if (!open) setEditingSequence(null);
          }}
          onSuccess={handleEditSuccess}
        />
      )}
    </div>
  );
}

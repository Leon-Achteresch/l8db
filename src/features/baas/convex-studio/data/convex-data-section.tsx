import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import {
  type ConvexDocument,
  convexDataDelete,
  convexDataReplace,
  convexDataResolve,
} from "@/lib/db/convex-studio-data";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSidebarPortal } from "../../baas-sidebar-portal";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import { ConvexDataConfirmDialog } from "./convex-data-confirm-dialog";
import { ConvexDataDocumentDialog } from "./convex-data-document-dialog";
import { ConvexDataDocumentSheet } from "./convex-data-document-sheet";
import { ConvexDataTableList } from "./convex-data-table-list";
import { ConvexDataTableView } from "./convex-data-table-view";
import { dataKey, withoutSystemFields } from "./convex-data-utils";

export function ConvexDataSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.convex.studio.data");
  const queryClient = useQueryClient();
  const [table, setTable] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ table: string; document: ConvexDocument } | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: dataKey(deployment) });

  async function openReference(id: string) {
    setResolving(id);
    try {
      const resolved = await convexDataResolve(deployment, id);
      setTable(resolved.table);
      setDetail(resolved);
    } catch (cause) {
      toast.error(String(cause));
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <BaasSidebarPortal>
        <ConvexDataTableList deployment={deployment} selected={table} onSelect={setTable} />
      </BaasSidebarPortal>
      {table ? (
        <ConvexDataTableView
          key={table}
          deployment={deployment}
          table={table}
          onOpenDocument={(document) => setDetail({ table, document })}
          onOpenReference={(id) => void openReference(id)}
          onDeleted={() => setTable(null)}
        />
      ) : (
        <div className="space-y-2 p-5">
          <h2 ref={feature.ref} className="flex items-center gap-2 text-base font-semibold">
            Daten {feature.isNew && <NewBadge />}
          </h2>
          <p className="text-xs text-muted-foreground">
            Wähle links eine Tabelle oder erstelle eine neue.
          </p>
        </div>
      )}
      <ConvexDataDocumentSheet
        entry={detail}
        resolving={resolving}
        onClose={() => setDetail(null)}
        onOpenReference={(id) => void openReference(id)}
        onEdit={() => setEditing(true)}
        onDelete={() => setDeleting(true)}
      />
      {editing && detail && (
        <ConvexDataDocumentDialog
          mode="edit"
          table={detail.table}
          initial={JSON.stringify(withoutSystemFields(detail.document), null, 2)}
          onOpenChange={setEditing}
          onSubmit={async ([document]) => {
            await convexDataReplace(deployment, detail.document._id, document);
            setDetail(await convexDataResolve(deployment, detail.document._id));
            await refresh();
          }}
        />
      )}
      <ConvexDataConfirmDialog
        open={deleting && detail !== null}
        title="Dokument löschen?"
        description={`Das Dokument ${detail?.document._id ?? ""} wird endgültig aus ${detail?.table ?? ""} gelöscht.`}
        action="Löschen"
        onOpenChange={setDeleting}
        onConfirm={async () => {
          if (!detail) return;
          await convexDataDelete(deployment, detail.table, [detail.document._id]);
          setDetail(null);
          await refresh();
        }}
      />
    </div>
  );
}

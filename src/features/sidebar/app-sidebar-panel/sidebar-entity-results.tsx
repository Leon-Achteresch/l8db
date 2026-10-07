import { useNavigate, useRouter } from "@tanstack/react-router";
import { memo, useMemo, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { ObjectDropDialog } from "@/features/object-admin/object-drop-dialog";
import { ObjectRenameInput } from "@/features/object-admin/object-rename-input";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { CopyTableDialog } from "@/features/table-copy/copy-table-dialog";
import { copyNameActions } from "@/lib/clipboard";
import type { SchemaCopyObjectType } from "@/lib/db";
import { menuKeyHandler } from "@/lib/hotkeys";
import { buildInvalidSet, isViewInvalid } from "@/lib/invalid-objects";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { EntityConfirmDialog } from "./entity-confirm-dialog";
import { EntityMatchingColumns } from "./entity-matching-columns";
import { EntityMenuItems } from "./entity-menu-items";
import { SidebarEntityButton } from "./sidebar-entity-button";
import { useSidebarEntityActions } from "./use-sidebar-entity-actions";
import { matchingColumnsWindow, type SidebarEntityMatch } from "./use-sidebar-entity-filter";

export const SidebarEntityResults = memo(function SidebarEntityResults({
  filtered,
  type,
}: {
  filtered: SidebarEntityMatch[];
  type: "table" | "view";
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const [renameTarget, setRenameTarget] = useState<{ schema: string; name: string } | null>(null);
  const [copyTarget, setCopyTarget] = useState<{
    schema: string;
    name: string;
    objectType: SchemaCopyObjectType;
  } | null>(null);
  const [tableCopySource, setTableCopySource] = useState<{ schema: string; name: string } | null>(
    null,
  );
  const [dropTarget, setDropTarget] = useState<{ schema: string; name: string } | null>(null);
  const actions = useSidebarEntityActions(type);
  const { confirmAction, setConfirmAction, actionLoading, caps, activeDatabase, openView } =
    actions;
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const measured = useMemo(() => matchingColumnsWindow(filtered), [filtered]);
  const isOpen = (item: { schema: string; name: string }) => {
    const params = router.state.matches.at(-1)?.params as
      | { schema?: string; table?: string; view?: string }
      | undefined;
    return params?.schema === item.schema && (params.table ?? params.view) === item.name;
  };

  return (
    <>
      <CopyToSchemaDialog target={copyTarget} onClose={() => setCopyTarget(null)} />
      <CopyTableDialog source={tableCopySource} onClose={() => setTableCopySource(null)} />
      <EntityConfirmDialog
        confirmAction={confirmAction}
        actionLoading={actionLoading}
        isRedis={caps.query_language === "redis"}
        activeDatabase={activeDatabase}
        onClose={() => setConfirmAction(null)}
        onConfirm={actions.handleConfirmAction}
      />
      <ObjectDropDialog
        open={dropTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
        schema={dropTarget?.schema ?? ""}
        name={dropTarget?.name ?? ""}
        objectType="view"
        onDropped={() => {
          if (dropTarget && isOpen(dropTarget)) void navigate({ to: "/" });
        }}
      />
      {filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarWindow count={filtered.length} measured={measured}>
          {(index) => {
            const item = filtered[index];
            const rename = caps.object_admin ? () => setRenameTarget(item) : undefined;
            const drop =
              type === "view"
                ? caps.object_admin
                  ? () => setDropTarget(item)
                  : undefined
                : caps.query_language === "redis"
                  ? undefined
                  : () => setConfirmAction({ kind: "drop", schema: item.schema, name: item.name });

            return (
              <SidebarMenuItem key={`${item.schema}.${item.name}`}>
                {renameTarget?.schema === item.schema && renameTarget.name === item.name ? (
                  <ObjectRenameInput
                    schema={item.schema}
                    name={item.name}
                    objectType={type}
                    onClose={() => setRenameTarget(null)}
                    onRenamed={(next) => {
                      if (!isOpen(item)) return;
                      if (type === "table")
                        void navigate({
                          to: "/tables/$schema/$table",
                          params: { schema: item.schema, table: next },
                          search: { type: "table" },
                        });
                      else
                        void navigate({
                          to: "/view-editor/$schema/$view",
                          params: { schema: item.schema, view: next },
                        });
                    }}
                  />
                ) : (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <SidebarEntityButton
                        entity={type}
                        schema={item.schema}
                        name={item.name}
                        first={index === 0 && type === "table"}
                        invalid={
                          type === "view" && isViewInvalid(invalidSet, item.schema, item.name)
                        }
                        onKeyDown={menuKeyHandler({
                          openInNewTab: () => actions.openInNewTab(item.schema, item.name),
                          newQuery: () => actions.handleOpenInEditor(item.schema, item.name),
                          ...copyNameActions(
                            item.name,
                            actions.qualifiedName(item.schema, item.name),
                          ),
                          rename,
                          drop,
                        })}
                        onOpenView={() => openView(item.schema, item.name)}
                      />
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <EntityMenuItems
                        type={type}
                        schema={item.schema}
                        name={item.name}
                        actions={actions}
                        onRename={rename}
                        onDrop={drop}
                        onCopyToSchema={() =>
                          setCopyTarget({ schema: item.schema, name: item.name, objectType: type })
                        }
                        onCopyToConnection={() =>
                          setTableCopySource({ schema: item.schema, name: item.name })
                        }
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                )}
                <EntityMatchingColumns
                  item={item}
                  type={type}
                  onOpenView={() => openView(item.schema, item.name)}
                />
              </SidebarMenuItem>
            );
          }}
        </SidebarWindow>
      )}
    </>
  );
});

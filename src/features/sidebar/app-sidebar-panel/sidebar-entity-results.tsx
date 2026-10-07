import { useNavigate, useRouter } from "@tanstack/react-router";
import { Star, StarOff } from "lucide";
import { CopyIcon, PencilIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { memo, useMemo, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { ObjectRenameInput } from "@/features/object-admin/object-rename-input";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { CopyTableDialog } from "@/features/table-copy/copy-table-dialog";
import type { SchemaCopyObjectType } from "@/lib/db";
import { buildInvalidSet, isViewInvalid } from "@/lib/invalid-objects";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { EntityConfirmDialog } from "./entity-confirm-dialog";
import { EntityMatchingColumns } from "./entity-matching-columns";
import { SidebarEntityButton } from "./sidebar-entity-button";
import { TableEntityMenuItems } from "./table-entity-menu-items";
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
  const {
    confirmAction,
    setConfirmAction,
    actionLoading,
    caps,
    activeDatabase,
    handleConfirmAction,
    handleOpenInEditor,
    handleScriptTable,
    toggleFavoriteObject,
    isFavorite,
    handleFocusInErDiagram,
    handleAlterTable,
    openView,
  } = useSidebarEntityActions(type);
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const measured = useMemo(() => matchingColumnsWindow(filtered), [filtered]);

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
        onConfirm={handleConfirmAction}
      />
      {filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarWindow count={filtered.length} measured={measured}>
          {(index) => {
            const item = filtered[index];
            const menuButton = (
              <SidebarEntityButton
                entity={type}
                schema={item.schema}
                name={item.name}
                first={index === 0 && type === "table"}
                invalid={type === "view" && isViewInvalid(invalidSet, item.schema, item.name)}
                onKeyDown={(event) => {
                  if (event.key === "F2" && caps.object_admin) {
                    event.preventDefault();
                    event.stopPropagation();
                    setRenameTarget(item);
                  }
                }}
                onOpenView={() => openView(item.schema, item.name)}
              />
            );

            return (
              <SidebarMenuItem key={`${item.schema}.${item.name}`}>
                {renameTarget?.schema === item.schema && renameTarget.name === item.name ? (
                  <ObjectRenameInput
                    schema={item.schema}
                    name={item.name}
                    objectType={type}
                    onClose={() => setRenameTarget(null)}
                    onRenamed={(next) => {
                      const params = router.state.matches.at(-1)?.params as
                        | { schema?: string; table?: string; view?: string }
                        | undefined;
                      if (
                        params?.schema !== item.schema ||
                        (params.table ?? params.view) !== item.name
                      )
                        return;
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
                ) : type === "table" ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{menuButton}</ContextMenuTrigger>
                    <ContextMenuContent>
                      <TableEntityMenuItems
                        schema={item.schema}
                        name={item.name}
                        caps={caps}
                        isFavorite={isFavorite(item.schema, item.name)}
                        onRename={() => setRenameTarget(item)}
                        onToggleFavorite={() => toggleFavoriteObject(item.schema, item.name)}
                        onOpenInEditor={() => handleOpenInEditor(item.schema, item.name)}
                        onScriptTable={() => handleScriptTable(item.schema, item.name)}
                        onCopy={() =>
                          setCopyTarget({
                            schema: item.schema,
                            name: item.name,
                            objectType: "table",
                          })
                        }
                        onCopyToConnection={() =>
                          setTableCopySource({ schema: item.schema, name: item.name })
                        }
                        onAlterTable={() => handleAlterTable(item.schema, item.name)}
                        onFocusInErDiagram={() => handleFocusInErDiagram(item.schema, item.name)}
                        onConfirm={setConfirmAction}
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                ) : (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{menuButton}</ContextMenuTrigger>
                    <ContextMenuContent>
                      {caps.object_admin && (
                        <ContextMenuItem onSelect={() => setRenameTarget(item)}>
                          <PencilIcon />
                          Umbenennen…
                        </ContextMenuItem>
                      )}
                      <CompareObjectMenuItem
                        schema={item.schema}
                        name={item.name}
                        objectType="view"
                      />
                      <ContextMenuItem
                        onSelect={() => toggleFavoriteObject(item.schema, item.name)}
                      >
                        <MorphIcon icon={isFavorite(item.schema, item.name) ? StarOff : Star} />
                        {isFavorite(item.schema, item.name) ? "Favorit lösen" : "Anheften"}
                      </ContextMenuItem>
                      {caps.schema_object_copy && (
                        <ContextMenuItem
                          onSelect={() =>
                            setCopyTarget({
                              schema: item.schema,
                              name: item.name,
                              objectType: "view",
                            })
                          }
                        >
                          <CopyIcon />
                          In anderem Schema erstellen
                        </ContextMenuItem>
                      )}
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

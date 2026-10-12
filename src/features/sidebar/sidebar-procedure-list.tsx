import { useNavigate } from "@tanstack/react-router";
import { SquareFunctionIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { CopyAsMenu } from "@/components/copy-as-menu";
import { ToolsMenu } from "@/components/tools-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { copyNameActions } from "@/lib/clipboard";
import type { SchemaCopyObjectType } from "@/lib/db";
import { useActiveCapabilities } from "@/lib/db-selection";
import { formatMenuShortcut, MENU_KEYS, menuKeyHandler } from "@/lib/hotkeys";
import { buildInvalidSet, isProcedureInvalid } from "@/lib/invalid-objects";
import { usePaneTabTarget } from "@/lib/pane-tab-target";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

interface SidebarProcedureListProps {
  items: { schema: string; name: string; identity_args: string; oid: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarProcedureList({
  items,
  isLoading,
  isError,
  error,
}: SidebarProcedureListProps) {
  const navigate = useNavigate();
  const openProcedureTab = useTableTabs((state) => state.openProcedureTab);
  const target = usePaneTabTarget();
  const capabilities = useActiveCapabilities();
  const { compile } = useCompileObject();
  const [copyTarget, setCopyTarget] = useState<{
    schema: string;
    name: string;
    objectType: SchemaCopyObjectType;
  } | null>(null);
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Prozeduren…
      </div>
    );
  }
  if (isError) {
    return <SidebarQueryError error={error} />;
  }
  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Prozeduren gefunden.</p>;
  }

  const open = (item: { schema: string; name: string; oid: string }) => {
    if (target) {
      target.open({ kind: "procedure", schema: item.schema, name: item.name, oid: item.oid });
      return;
    }
    openProcedureTab({ schema: item.schema, name: item.name, oid: item.oid });
    void navigate({
      to: "/procedures/$schema/$name",
      params: { schema: item.schema, name: item.name },
      search: { oid: item.oid },
    });
  };

  return (
    <>
      <CopyToSchemaDialog target={copyTarget} onClose={() => setCopyTarget(null)} />
      <SidebarWindow count={items.length}>
        {(index) => {
          const item = items[index];
          const qualifiedName = `${item.schema}.${item.name}`;
          return (
            <SidebarMenuItem key={item.oid}>
              <ContextMenu>
                <ContextMenuTrigger
                  asChild
                  onKeyDown={menuKeyHandler(copyNameActions(item.name, qualifiedName))}
                >
                  <SidebarMenuButton onClick={() => open(item)}>
                    <SquareFunctionIcon className="text-muted-foreground" />
                    <span className="truncate">
                      {item.name}
                      {item.identity_args ? `(${item.identity_args})` : "()"}
                    </span>
                    {isProcedureInvalid(invalidSet, item.schema, item.name) ? (
                      <InvalidMarker />
                    ) : null}
                  </SidebarMenuButton>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => open(item)}>
                    Öffnen
                    <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.open)}</ContextMenuShortcut>
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <CopyAsMenu name={item.name} qualifiedName={qualifiedName} shortcuts />
                  <ContextMenuSeparator />
                  {capabilities.compile_objects ? (
                    <ContextMenuItem
                      onSelect={() => {
                        void compile(item.oid, "procedure", qualifiedName);
                      }}
                    >
                      Kompilieren
                    </ContextMenuItem>
                  ) : null}
                  <ToolsMenu>
                    <CompareObjectMenuItem
                      schema={item.schema}
                      name={item.name}
                      objectType="procedure"
                      oid={item.oid}
                      identityArgs={item.identity_args}
                    />
                    {capabilities.schema_object_copy ? (
                      <ContextMenuItem
                        onSelect={() =>
                          setCopyTarget({
                            schema: item.schema,
                            name: item.name,
                            objectType: "routine",
                          })
                        }
                      >
                        In anderem Schema erstellen…
                      </ContextMenuItem>
                    ) : null}
                  </ToolsMenu>
                </ContextMenuContent>
              </ContextMenu>
            </SidebarMenuItem>
          );
        }}
      </SidebarWindow>
    </>
  );
}

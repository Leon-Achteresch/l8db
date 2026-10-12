import { useNavigate } from "@tanstack/react-router";
import { ListOrderedIcon } from "lucide-react";
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
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { copyNameActions } from "@/lib/clipboard";
import { formatMenuShortcut, MENU_KEYS, menuKeyHandler } from "@/lib/hotkeys";
import { usePaneTabTarget } from "@/lib/pane-tab-target";

export interface SidebarSequenceListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarSequenceList({
  items,
  isLoading,
  isError,
  error,
}: SidebarSequenceListProps) {
  const navigate = useNavigate();
  const target = usePaneTabTarget();

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Sequenzen…
      </div>
    );
  }

  if (isError) {
    return <SidebarQueryError error={error} />;
  }

  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Sequenzen gefunden.</p>;
  }

  return (
    <SidebarWindow count={items.length}>
      {(index) => {
        const item = items[index];
        const qualifiedName = `${item.schema}.${item.name}`;
        const open = () =>
          target
            ? target.open({ kind: "tool", tool: "sequences" })
            : navigate({ to: "/sequences" });
        return (
          <SidebarMenuItem key={qualifiedName}>
            <ContextMenu>
              <ContextMenuTrigger
                asChild
                onKeyDown={menuKeyHandler(copyNameActions(item.name, qualifiedName))}
              >
                <SidebarMenuButton onClick={open}>
                  <ListOrderedIcon className="text-muted-foreground" />
                  <span className="truncate">{item.name}</span>
                </SidebarMenuButton>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={open}>
                  Öffnen
                  <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.open)}</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <CopyAsMenu name={item.name} qualifiedName={qualifiedName} shortcuts />
                <ContextMenuSeparator />
                <ToolsMenu>
                  <CompareObjectMenuItem
                    schema={item.schema}
                    name={item.name}
                    objectType="sequence"
                  />
                </ToolsMenu>
              </ContextMenuContent>
            </ContextMenu>
          </SidebarMenuItem>
        );
      }}
    </SidebarWindow>
  );
}

import { PlayIcon } from "lucide-react";
import { useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { useExtensionHost, useExtensionViews } from "@/lib/extensions/react-context";
import { ExtensionTreeNode } from "./extension-sidebar-views/extension-tree-node";

export function ExtensionSidebarViews() {
  const views = useExtensionViews().filter((view) => view.location === "sidebar");
  const host = useExtensionHost();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  if (views.length === 0) return null;
  return (
    <>
      {views.map((view) => {
        const isCollapsed = collapsed.includes(view.viewId);
        const titleActions = host.commands.menusFor("view/title", view.viewId);
        return (
          <SidebarGroup key={view.viewId}>
            <div className="flex items-center gap-1">
              <SidebarGroupLabel className="flex-1">{view.title}</SidebarGroupLabel>
              {titleActions.map((menu) => (
                <button
                  key={menu.command}
                  type="button"
                  title={host.commands.list().find((c) => c.id === menu.command)?.title}
                  onClick={() => void host.executeCommand(menu.command).catch(() => undefined)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <PlayIcon className="size-3" />
                </button>
              ))}
              <button
                type="button"
                aria-label={isCollapsed ? "Erweitern" : "Reduzieren"}
                onClick={() =>
                  setCollapsed((previous) =>
                    isCollapsed
                      ? previous.filter((id) => id !== view.viewId)
                      : [...previous, view.viewId],
                  )
                }
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {isCollapsed ? "+" : "–"}
              </button>
            </div>
            {!isCollapsed && (
              <SidebarGroupContent>
                {view.items.length === 0 ? (
                  <p className="py-1 text-xs text-muted-foreground">Keine Einträge.</p>
                ) : (
                  <SidebarMenu>
                    {view.items.map((item) => (
                      <ExtensionTreeNode key={item.id} viewId={view.viewId} item={item} depth={0} />
                    ))}
                  </SidebarMenu>
                )}
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        );
      })}
    </>
  );
}

import {
  BracesIcon,
  DatabaseIcon,
  EyeIcon,
  FileCodeIcon,
  FileIcon,
  FolderIcon,
  PackageIcon,
  PlayIcon,
  StarIcon,
  TableIcon,
} from "lucide-react";
import { useState } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import type { TreeItem } from "@/lib/extensions/contracts";
import { useExtensionHost, useExtensionViews } from "@/lib/extensions/react-context";
import { cn } from "@/lib/utils";

function iconFor(name: string | undefined) {
  switch (name) {
    case "folder":
      return FolderIcon;
    case "file":
      return FileIcon;
    case "database":
      return DatabaseIcon;
    case "table":
      return TableIcon;
    case "eye":
      return EyeIcon;
    case "code":
      return FileCodeIcon;
    case "package":
      return PackageIcon;
    case "star":
      return StarIcon;
    case "braces":
      return BracesIcon;
    default:
      return FileIcon;
  }
}

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

function ExtensionTreeNode({
  viewId,
  item,
  depth,
}: {
  viewId: string;
  item: TreeItem;
  depth: number;
}) {
  const host = useExtensionHost();
  const [expanded, setExpanded] = useState(item.expanded ?? depth === 0);
  const Icon = iconFor(item.icon);
  const itemActions = host.commands.menusFor("view/item", viewId);
  const hasChildren = (item.children ?? []).length > 0;
  return (
    <SidebarMenuItem>
      <div className="group flex items-center gap-0.5">
        <SidebarMenuButton
          size="sm"
          className="flex-1"
          onClick={() => {
            if (hasChildren) setExpanded((previous) => !previous);
            if (item.command)
              void host
                .executeCommand(item.command, item.commandArguments ?? undefined)
                .catch(() => undefined);
          }}
        >
          {hasChildren ? (
            <span className={cn("text-muted-foreground", expanded && "rotate-90")}>▸</span>
          ) : (
            <Icon className="text-muted-foreground" />
          )}
          <span className="truncate">{item.label}</span>
          {item.description && (
            <span className="truncate text-[10px] text-muted-foreground">{item.description}</span>
          )}
          {item.badge !== undefined && (
            <span className="ml-auto rounded-full bg-primary/12 px-1.5 text-[10px] tabular-nums">
              {item.badge}
            </span>
          )}
        </SidebarMenuButton>
        {itemActions.map((menu) => (
          <button
            key={menu.command}
            type="button"
            title={host.commands.list().find((c) => c.id === menu.command)?.title ?? menu.command}
            onClick={() =>
              void host
                .executeCommand(menu.command, { viewId, itemId: item.id })
                .catch(() => undefined)
            }
            className="hidden rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:block"
          >
            <PlayIcon className="size-3" />
          </button>
        ))}
      </div>
      {hasChildren && expanded && (
        <SidebarMenuSub>
          {(item.children ?? []).map((child) => (
            <ExtensionTreeNode key={child.id} viewId={viewId} item={child} depth={depth + 1} />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}

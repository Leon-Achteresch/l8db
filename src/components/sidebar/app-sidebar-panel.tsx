import type * as React from "react";

import { Link } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  DatabaseIcon,
  SettingsIcon,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { useConnections } from "@/lib/connections";
import { useSidebarPanel } from "@/lib/sidebar-panel";

export function AppSidebarPanel() {
  const { connections, activeConnection, setActiveId } = useConnections();
  const setWidth = useSidebarPanel((state) => state.setWidth);
  const setIsResizing = useSidebarPanel((state) => state.setIsResizing);

  const handleResizeStart = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = useSidebarPanel.getState().width;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setWidth(startWidth + (moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <Sidebar collapsible="none" className="relative hidden flex-1 md:flex">
      <SidebarHeader className="gap-3.5 border-b p-4">
        <div className="text-base font-medium text-foreground">Verbindung</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <DatabaseIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">
                {activeConnection ? activeConnection.name : "Keine Verbindung"}
              </span>
              <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel>Verbindung wechseln</DropdownMenuLabel>
            {connections.length === 0 ? (
              <DropdownMenuItem disabled>
                Keine Verbindungen gespeichert
              </DropdownMenuItem>
            ) : (
              connections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  onSelect={() => setActiveId(connection.id)}
                >
                  <DatabaseIcon className="text-muted-foreground" />
                  <span className="flex-1 truncate">{connection.name}</span>
                  {connection.id === activeConnection?.id ? (
                    <CheckIcon className="size-4" />
                  ) : null}
                </DropdownMenuItem>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/connections">
                <SettingsIcon className="text-muted-foreground" />
                Verbindungen verwalten
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="px-0">
          <SidebarGroupContent />
        </SidebarGroup>
      </SidebarContent>
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={handleResizeStart}
        className="absolute inset-y-0 right-0 z-20 w-1 cursor-col-resize bg-transparent transition-colors hover:bg-sidebar-border"
      />
    </Sidebar>
  );
}

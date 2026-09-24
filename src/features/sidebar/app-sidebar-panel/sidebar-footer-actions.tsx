import { Link } from "@tanstack/react-router";
import { ActivityIcon, ArchiveIcon, ListIcon, PlusIcon, RadioIcon, UploadIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { useActiveCapabilities } from "@/lib/db-selection";
import { useSettingsStore } from "@/lib/settings";

interface SidebarFooterActionsProps {
  caps: ReturnType<typeof useActiveCapabilities>;
}

export function SidebarFooterActions({ caps }: SidebarFooterActionsProps) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  return (
    <SidebarGroup className="mt-auto border-t pt-2">
      <SidebarGroupContent>
        <SidebarMenu>
          {caps.query_language === "sql" && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/import">
                  <UploadIcon className="text-muted-foreground" />
                  <span>SQL importieren</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {caps.backup && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/backup">
                  <ArchiveIcon className="text-muted-foreground" />
                  <span>Sichern & Wiederherstellen</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {caps.ddl && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/create-table">
                  <PlusIcon className="text-muted-foreground" />
                  <span>
                    {caps.query_language === "json" ? "Collection erstellen" : "Tabelle erstellen"}
                  </span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {!easyMode && caps.sessions && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/sessions">
                  <ActivityIcon className="text-muted-foreground" />
                  <span>Sitzungen & Locks</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {!easyMode && caps.replication && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/replication">
                  <RadioIcon className="text-muted-foreground" />
                  <span>Replikation</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {!easyMode && caps.enums && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link to="/enums">
                  <ListIcon className="text-muted-foreground" />
                  <span>Enum-Typen</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

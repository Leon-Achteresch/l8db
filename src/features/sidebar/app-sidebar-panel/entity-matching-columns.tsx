import { Link } from "@tanstack/react-router";
import { ColumnsIcon } from "lucide-react";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";

interface EntityMatchingColumnsProps {
  item: { schema: string; name: string; matchingColumns: string[] };
  type: "table" | "view";
  onOpenView: () => void;
}

export function EntityMatchingColumns({ item, type, onOpenView }: EntityMatchingColumnsProps) {
  if (item.matchingColumns.length === 0) return null;
  return (
    <SidebarMenuSub>
      {item.matchingColumns.map((col) => (
        <SidebarMenuSubItem key={col}>
          {type === "view" ? (
            <SidebarMenuSubButton size="sm" onClick={onOpenView}>
              <ColumnsIcon className="text-muted-foreground" />
              <span className="truncate">{col}</span>
            </SidebarMenuSubButton>
          ) : (
            <SidebarMenuSubButton size="sm" asChild>
              <Link
                to="/tables/$schema/$table"
                params={{
                  schema: item.schema,
                  table: item.name,
                }}
                search={{ type, column: col }}
              >
                <ColumnsIcon className="text-muted-foreground" />
                <span className="truncate">{col}</span>
              </Link>
            </SidebarMenuSubButton>
          )}
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
}

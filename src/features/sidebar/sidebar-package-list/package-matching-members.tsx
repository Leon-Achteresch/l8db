import { BracesIcon } from "lucide-react";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { usePackageNavigate } from "./use-package-navigate";

export function PackageMatchingMembers({
  schema,
  name,
  members,
}: {
  schema: string;
  name: string;
  members: string[];
}) {
  const go = usePackageNavigate(schema, name);
  return (
    <SidebarMenuSub>
      {members.map((member) => (
        <SidebarMenuSubItem key={member}>
          <SidebarMenuSubButton size="sm" onClick={() => go("body", member)}>
            <BracesIcon className="text-muted-foreground" />
            <span className="truncate">{member}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      ))}
    </SidebarMenuSub>
  );
}

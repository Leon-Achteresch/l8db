import type { ReactNode } from "react";
import {
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";

export function ToolsMenu({ children }: { children: ReactNode }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>Werkzeuge</ContextMenuSubTrigger>
      <ContextMenuSubContent>{children}</ContextMenuSubContent>
    </ContextMenuSub>
  );
}

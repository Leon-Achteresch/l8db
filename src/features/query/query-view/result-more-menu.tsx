import { MoreHorizontalIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconMenu } from "@/components/icon-menu/icon-menu";
import { IconMenuContent } from "@/components/icon-menu/icon-menu-content";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ResultMoreMenu({ children }: { children: ReactNode }) {
  return (
    <IconMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon"
          className="size-7"
          variant="ghost"
          aria-label="Weitere Ergebnis-Aktionen"
        >
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <IconMenuContent>{children}</IconMenuContent>
    </IconMenu>
  );
}

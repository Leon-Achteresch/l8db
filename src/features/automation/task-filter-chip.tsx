import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string | null;
  children: ReactNode;
}

export function TaskFilterChip({ label, value, children }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          value
            ? "border-primary/30 bg-primary/8 text-foreground"
            : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <span className="truncate">{value ? `${label}: ${value}` : label}</span>
        <ChevronDownIcon aria-hidden className="size-3 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 w-52 overflow-y-auto">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

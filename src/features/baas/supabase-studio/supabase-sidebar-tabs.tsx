import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BaasSidebarPortal } from "../baas-sidebar-portal";

export interface SupabaseSidebarTab {
  value: string;
  label: string;
  icon: LucideIcon;
  hint?: ReactNode;
  disabledReason?: string | null;
}

export function SupabaseSidebarTabs({
  label,
  items,
  children,
}: {
  label: string;
  items: SupabaseSidebarTab[];
  children?: ReactNode;
}) {
  return (
    <BaasSidebarPortal>
      <TabsList
        aria-label={label}
        className="h-auto! w-full flex-col items-stretch gap-0.5 rounded-none bg-transparent p-0"
      >
        {items.map((item) => (
          <span
            key={item.value}
            role="presentation"
            title={item.disabledReason ?? undefined}
            className="flex"
          >
            <TabsTrigger
              value={item.value}
              disabled={Boolean(item.disabledReason)}
              className="h-7 flex-1 justify-start gap-2 rounded-md border-0 px-2 text-xs font-normal text-sidebar-foreground shadow-none! after:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=active]:bg-sidebar-accent! data-[state=active]:font-medium data-[state=active]:text-sidebar-accent-foreground dark:data-[state=active]:border-transparent [&_svg]:size-4! [&_svg]:text-muted-foreground"
            >
              <item.icon />
              <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
              {item.hint !== undefined && item.hint !== null && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {item.hint}
                </span>
              )}
            </TabsTrigger>
          </span>
        ))}
      </TabsList>
      {children}
    </BaasSidebarPortal>
  );
}

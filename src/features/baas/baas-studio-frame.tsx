import { type ReactNode, type Ref, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { type SidebarObjectTab, SidebarObjectTabs } from "@/features/sidebar/sidebar-object-tabs";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { BaasSidebarSlot } from "./baas-sidebar-portal";

export function BaasStudioFrame({
  label,
  navRef,
  isNew,
  header,
  details,
  footer,
  tabs,
  value,
  onValueChange,
  children,
}: {
  label: string;
  navRef?: Ref<HTMLElement>;
  isNew?: boolean;
  header: ReactNode;
  details?: ReactNode;
  footer?: ReactNode;
  tabs: SidebarObjectTab[];
  value: string;
  onValueChange: (value: string) => unknown;
  children: ReactNode;
}) {
  const width = useSidebarPanel((state) => state.width);
  const active = tabs.find((tab) => tab.value === value);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div data-baas-studio className="flex h-full min-h-0">
      <aside
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden text-sidebar-foreground"
      >
        <div className="space-y-2 border-b p-2">
          {header}
          <div className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
            <span
              className="min-w-0 flex-1 truncate"
              title={typeof details === "string" ? details : undefined}
            >
              {details}
            </span>
            {isNew && <NewBadge />}
          </div>
        </div>
        <nav ref={navRef} aria-label={label} className="shrink-0 border-b px-2 py-2">
          <SidebarObjectTabs tabs={tabs} value={value} onValueChange={onValueChange} />
        </nav>
        <p className="flex h-8 shrink-0 items-center px-4 [&:has(+div:empty)]:hidden text-xs font-medium text-sidebar-foreground/70">
          {active?.label}
        </p>
        <div
          ref={setSlot}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 empty:hidden"
        />
        {footer && <div className="mt-auto border-t p-2">{footer}</div>}
      </aside>
      <div
        data-slot="sidebar-inset"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl border-t border-l bg-background shadow-lg shadow-black/10 dark:shadow-black/40"
      >
        <section
          aria-label={active?.label}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <BaasSidebarSlot.Provider value={slot}>{children}</BaasSidebarSlot.Provider>
        </section>
      </div>
    </div>
  );
}

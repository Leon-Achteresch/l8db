import type { ReactNode, Ref } from "react";
import { NewBadge } from "@/components/new-badge";
import { type SidebarObjectTab, SidebarObjectTabs } from "@/features/sidebar/sidebar-object-tabs";
import { useSidebarPanel } from "@/lib/sidebar-panel";

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

  return (
    <div data-baas-studio className="flex h-full min-h-0">
      <aside
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden text-sidebar-foreground"
      >
        <div className="border-b p-2">{header}</div>
        <nav ref={navRef} aria-label={label} className="shrink-0 border-b px-2 py-2">
          <SidebarObjectTabs tabs={tabs} value={value} onValueChange={onValueChange} />
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <p className="flex h-8 items-center gap-2 px-2 text-xs font-medium text-sidebar-foreground/70">
            {label}
            {isNew && <NewBadge />}
          </p>
          {details}
        </div>
        {footer && <div className="border-t p-2">{footer}</div>}
      </aside>
      <div
        data-slot="sidebar-inset"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl border-t border-l bg-background shadow-lg shadow-black/10 dark:shadow-black/40"
      >
        <section aria-label={active?.label} className="min-h-0 flex-1 overflow-auto p-5">
          {children}
        </section>
      </div>
    </div>
  );
}

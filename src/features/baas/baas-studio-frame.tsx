import { type ReactNode, type Ref, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { type StudioPaletteTables, useStudioPaletteScope } from "@/lib/studio-palette";
import { BaasSidebarSlot } from "./baas-sidebar-portal";
import { BaasStudioNav, type BaasStudioTab } from "./baas-studio-nav";

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
  fullBleed,
  sidebarLabel,
  paletteKey,
  paletteTables,
  children,
}: {
  label: string;
  navRef?: Ref<HTMLElement>;
  isNew?: boolean;
  header: ReactNode;
  details?: ReactNode;
  footer?: ReactNode;
  tabs: BaasStudioTab[];
  value: string;
  onValueChange: (value: string) => unknown;
  fullBleed?: boolean;
  sidebarLabel?: string;
  paletteKey: string;
  paletteTables?: StudioPaletteTables;
  children: ReactNode;
}) {
  const width = useSidebarPanel((state) => state.width);
  const active = tabs.find((tab) => tab.value === value);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useStudioPaletteScope({
    key: paletteKey,
    label,
    sections: tabs.map((tab) => ({
      id: tab.value,
      label: tab.label,
      icon: tab.icon,
      disabled: Boolean(tab.disabledReason),
    })),
    openSection: onValueChange,
    tables: paletteTables,
  });

  return (
    <div data-baas-studio className="flex h-full min-h-0">
      <aside
        style={{ width }}
        className="flex min-h-0 shrink-0 flex-col overflow-hidden text-sidebar-foreground"
      >
        <div className="space-y-2 p-2">
          {header}
          <div className="flex min-w-0 items-center gap-2 px-1 text-[11px] text-muted-foreground">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary/70" />
            <span
              className="min-w-0 flex-1 truncate"
              title={typeof details === "string" ? details : undefined}
            >
              {details}
            </span>
            {isNew && <NewBadge />}
          </div>
        </div>
        <nav ref={navRef} aria-label={label} className="shrink-0 px-2 pb-2">
          <BaasStudioNav tabs={tabs} value={value} onValueChange={onValueChange} />
        </nav>
        <p className="flex h-8 shrink-0 items-center gap-2 border-t px-4 pt-1 text-[10px] font-semibold tracking-[0.12em] text-sidebar-foreground/60 uppercase [&:has(+div:empty)]:hidden">
          {sidebarLabel ?? active?.label}
        </p>
        <div
          ref={setSlot}
          data-baas-context
          className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 empty:hidden"
        />
        {footer && <div className="mt-auto border-t p-2">{footer}</div>}
      </aside>
      <div
        data-slot="sidebar-inset"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl border-t border-l bg-background"
      >
        <section
          aria-label={active?.label}
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
        >
          <BaasSidebarSlot.Provider value={slot}>
            {fullBleed ? (
              <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto">
                <div className="mx-auto w-full max-w-6xl px-6 pt-6 pb-10">{children}</div>
              </div>
            )}
          </BaasSidebarSlot.Provider>
        </section>
      </div>
    </div>
  );
}

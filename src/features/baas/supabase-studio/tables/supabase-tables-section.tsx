import { useState } from "react";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSidebarPortal } from "../../baas-sidebar-portal";
import { SupabaseSectionHeader } from "../supabase-section-header";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseTableEditor } from "./supabase-table-editor";
import { SupabaseTablesBrowser } from "./supabase-tables-browser";
import { SupabaseTablesMap } from "./supabase-tables-map";
import { SupabaseTablesOpener } from "./supabase-tables-opener";
import {
  loadRecentTables,
  rememberRecentTable,
  type StudioTableRef,
} from "./supabase-tables-utils";

export function SupabaseTablesSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.tables");
  const [selected, setSelected] = useState<StudioTableRef | null>(null);
  const reference = project.reference;
  const [recent, setRecent] = useState(() => loadRecentTables(reference));

  function select(table: StudioTableRef | null) {
    setSelected(table);
    if (table && !capabilities.sql) {
      setRecent(rememberRecentTable(reference, table));
    }
  }

  return (
    <>
      <BaasSidebarPortal>
        {capabilities.sql ? (
          <SupabaseTablesBrowser reference={reference} selected={selected} onSelect={select} />
        ) : (
          <SupabaseTablesOpener selected={selected} recent={recent} onSelect={select} />
        )}
      </BaasSidebarPortal>
      {selected ? (
        <SupabaseTableEditor
          key={`${selected.schema}.${selected.name}`}
          reference={reference}
          table={selected}
          sql={capabilities.sql}
          onSelect={select}
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
          <SupabaseSectionHeader
            title="Tabellen"
            titleRef={feature.ref}
            isNew={feature.isNew}
            description={
              capabilities.sql
                ? "Die Landkarte zeigt, wo die Daten liegen. Wähle eine Tabelle hier oder links, oder erstelle eine neue."
                : "Öffne links eine Tabelle über ihren Namen."
            }
          />
          {capabilities.sql && <SupabaseTablesMap reference={reference} onSelect={select} />}
        </div>
      )}
    </>
  );
}

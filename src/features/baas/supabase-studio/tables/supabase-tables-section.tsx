import { getRouteApi, useNavigate } from "@tanstack/react-router";
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

const route = getRouteApi("/baas");

export function SupabaseTablesSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.tables");
  const search = route.useSearch();
  const navigate = useNavigate();
  const selected: StudioTableRef | null =
    search.table && search.tableProject === project.reference
      ? { schema: search.tableSchema ?? "public", name: search.table }
      : null;
  const reference = project.reference;
  const [recent, setRecent] = useState(() => loadRecentTables(reference));

  function select(table: StudioTableRef | null) {
    void navigate({
      to: "/baas",
      search: {
        ...search,
        table: table?.name,
        tableSchema: table?.schema,
        tableProject: table ? reference : undefined,
      },
      replace: true,
    });
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

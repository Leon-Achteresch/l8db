import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseTableEditor } from "./supabase-table-editor";
import { SupabaseTablesBrowser } from "./supabase-tables-browser";
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
    <div className="space-y-4">
      <h2 ref={feature.ref} className="flex items-center gap-2 text-base font-semibold">
        Tabellen {feature.isNew && <NewBadge />}
      </h2>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {capabilities.sql ? (
          <SupabaseTablesBrowser reference={reference} selected={selected} onSelect={select} />
        ) : (
          <SupabaseTablesOpener selected={selected} recent={recent} onSelect={select} />
        )}
        {selected ? (
          <SupabaseTableEditor
            key={`${selected.schema}.${selected.name}`}
            reference={reference}
            table={selected}
            sql={capabilities.sql}
            onSelect={select}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            {capabilities.sql
              ? "Wähle links eine Tabelle oder erstelle eine neue."
              : "Öffne links eine Tabelle über ihren Namen."}
          </p>
        )}
      </div>
    </div>
  );
}

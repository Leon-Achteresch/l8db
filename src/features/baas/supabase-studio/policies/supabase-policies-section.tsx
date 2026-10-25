import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SECTION_TABS_CLASS } from "../supabase-section-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { PolicyList } from "./policy-list";
import { PolicyTables } from "./policy-tables";

export function SupabasePoliciesSection({ project }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.policies");
  const [tab, setTab] = useState("tables");
  return (
    <div className="space-y-5">
      <SupabaseSectionHeader
        title="Richtlinien"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Wer über die Data API welche Zeilen lesen und ändern darf: Row Level Security je Tabelle und Befehl."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className={SECTION_TABS_CLASS}>
          <TabsTrigger value="tables" className="text-xs">
            Tabellen
          </TabsTrigger>
          <TabsTrigger value="storage" className="text-xs">
            Storage
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tables" className="pt-3">
          {tab === "tables" && <PolicyTables reference={project.reference} />}
        </TabsContent>
        <TabsContent value="storage" className="space-y-3 pt-3">
          {tab === "storage" && (
            <>
              <p className="text-xs text-muted-foreground">
                Richtlinien auf storage.objects steuern den Zugriff auf Dateien in allen Buckets.
                Mit bucket_id = 'name' im Ausdruck gilt eine Richtlinie nur für einen Bucket.
              </p>
              <PolicyList reference={project.reference} schema="storage" table="objects" />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { FolderOpen, Table2 } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SupabaseSectionTitle } from "../supabase-section-title";
import { SupabaseSidebarTabs } from "../supabase-sidebar-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { PolicyList } from "./policy-list";
import { PolicyTables } from "./policy-tables";

const TABS = [
  { value: "tables", label: "Tabellen", icon: Table2 },
  { value: "storage", label: "Storage", icon: FolderOpen, hint: "storage.objects" },
];

export function SupabasePoliciesSection({ project }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.policies");
  const [tab, setTab] = useState("tables");
  return (
    <div className="space-y-5">
      <SupabaseSectionHeader
        title={
          <SupabaseSectionTitle
            section="Richtlinien"
            part={TABS.find((item) => item.value === tab)?.label}
          />
        }
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Wer über die Data API welche Zeilen lesen und ändern darf: Row Level Security je Tabelle und Befehl."
      />
      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex-col">
        <SupabaseSidebarTabs label="Richtlinien" items={TABS} />
        <TabsContent value="tables">
          {tab === "tables" && <PolicyTables reference={project.reference} />}
        </TabsContent>
        <TabsContent value="storage" className="space-y-3">
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

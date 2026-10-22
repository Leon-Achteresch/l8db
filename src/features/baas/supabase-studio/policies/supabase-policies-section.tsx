import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { PolicyList } from "./policy-list";
import { PolicyTables } from "./policy-tables";

export function SupabasePoliciesSection({ project }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.policies");
  const [tab, setTab] = useState("tables");
  return (
    <div className="space-y-4">
      <h2 ref={feature.ref} className="flex items-center gap-2 text-base font-semibold">
        Richtlinien {feature.isNew && <NewBadge />}
      </h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
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

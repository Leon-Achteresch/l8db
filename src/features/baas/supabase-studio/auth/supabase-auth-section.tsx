import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SECTION_TABS_CLASS } from "../supabase-section-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseAuthConfigPanel } from "./supabase-auth-config";
import { SupabaseAuthUsers } from "./supabase-auth-users";

export function SupabaseAuthSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.auth");
  const [tab, setTab] = useState("users");

  return (
    <div className="grid gap-5">
      <SupabaseSectionHeader
        title="Auth"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Benutzer, Anmeldemethoden und Sitzungen des Projekts."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className={SECTION_TABS_CLASS}>
          <TabsTrigger value="users" className="text-xs">
            Benutzer
          </TabsTrigger>
          <TabsTrigger value="config" className="text-xs">
            Konfiguration
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-3">
          <SupabaseAuthUsers reference={project.reference} capabilities={capabilities} />
        </TabsContent>
        <TabsContent value="config" className="mt-3">
          <SupabaseAuthConfigPanel reference={project.reference} capabilities={capabilities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { Settings2, Users } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SupabaseSectionTitle } from "../supabase-section-title";
import { SupabaseSidebarTabs } from "../supabase-sidebar-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseAuthConfigPanel } from "./supabase-auth-config";
import { SupabaseAuthUsers } from "./supabase-auth-users";

const TABS = [
  { value: "users", label: "Benutzer", icon: Users },
  { value: "config", label: "Konfiguration", icon: Settings2 },
];

export function SupabaseAuthSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.auth");
  const [tab, setTab] = useState("users");

  return (
    <div className="grid gap-5">
      <SupabaseSectionHeader
        title={
          <SupabaseSectionTitle
            section="Auth"
            part={TABS.find((item) => item.value === tab)?.label}
          />
        }
        titleRef={feature.ref}
        isNew={feature.isNew}
        description="Benutzer, Anmeldemethoden und Sitzungen des Projekts."
      />
      <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="flex-col">
        <SupabaseSidebarTabs label="Auth" items={TABS} />
        <TabsContent value="users">
          <SupabaseAuthUsers reference={project.reference} capabilities={capabilities} />
        </TabsContent>
        <TabsContent value="config">
          <SupabaseAuthConfigPanel reference={project.reference} capabilities={capabilities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

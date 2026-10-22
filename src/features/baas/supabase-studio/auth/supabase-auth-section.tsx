import { Users } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import { SupabaseAuthConfigPanel } from "./supabase-auth-config";
import { SupabaseAuthUsers } from "./supabase-auth-users";

export function SupabaseAuthSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.auth");
  const [tab, setTab] = useState("users");

  return (
    <div className="grid gap-4">
      <h2 ref={feature.ref} className="flex items-center gap-2 text-base font-semibold">
        <Users className="size-4 text-muted-foreground" /> Auth
        {feature.isNew && <NewBadge />}
      </h2>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-8">
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

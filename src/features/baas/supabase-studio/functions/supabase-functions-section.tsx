import { Code2, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { SupabaseSectionHeader } from "../supabase-section-header";
import { SupabaseSidebarTabs } from "../supabase-sidebar-tabs";
import type { SupabaseStudioSectionProps } from "../supabase-studio-sections";
import {
  SupabaseFunctionDeployDialog,
  type SupabaseFunctionDeployTarget,
} from "./supabase-function-deploy-dialog";
import { SupabaseFunctionDetail } from "./supabase-function-detail";
import { SupabaseFunctionSecrets } from "./supabase-function-secrets";
import { SupabaseFunctionsList } from "./supabase-functions-list";

const SELF_HOSTED_HINT =
  "Selbst gehostet werden Funktionen als Dateien im Server-Volume verwaltet.";

export function SupabaseFunctionsSection({ project, capabilities }: SupabaseStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.supabase.studio.functions");
  const cloud = capabilities.management;
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("functions");
  const [deploy, setDeploy] = useState<SupabaseFunctionDeployTarget | null>(null);

  return (
    <div className="space-y-5">
      <SupabaseSectionHeader
        title="Edge Functions"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description={
          cloud
            ? "Funktionen deployen, konfigurieren, testen und Secrets verwalten."
            : `${SELF_HOSTED_HINT} Hier kannst du bekannte Funktionen aufrufen und testen.`
        }
        actions={
          <Button
            size="sm"
            disabled={!cloud}
            title={cloud ? undefined : SELF_HOSTED_HINT}
            onClick={() => setDeploy({ slug: "", name: "", verifyJwt: true })}
          >
            <Plus className="size-3.5" /> Neue Funktion
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <SupabaseSidebarTabs
          label="Edge Functions"
          items={[
            { value: "functions", label: "Funktionen", icon: Code2 },
            {
              value: "secrets",
              label: "Secrets",
              icon: KeyRound,
              disabledReason: cloud ? null : SELF_HOSTED_HINT,
            },
          ]}
        >
          <div className="mt-3 border-t pt-2">
            <SupabaseFunctionsList
              reference={project.reference}
              cloud={cloud}
              selected={selected}
              onSelect={(id) => {
                setSelected(id);
                setTab("functions");
              }}
            />
          </div>
        </SupabaseSidebarTabs>
        <TabsContent value="functions">
          <div>
            {selected ? (
              <SupabaseFunctionDetail
                key={selected}
                reference={project.reference}
                slug={selected}
                cloud={cloud}
                hasProjectKey={capabilities.data_api}
                onDeploy={setDeploy}
                onDeleted={() => setSelected(null)}
              />
            ) : (
              <p className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                Funktion links auswählen.
              </p>
            )}
          </div>
        </TabsContent>
        {cloud && (
          <TabsContent value="secrets">
            <SupabaseFunctionSecrets reference={project.reference} />
          </TabsContent>
        )}
      </Tabs>
      {deploy && (
        <SupabaseFunctionDeployDialog
          key={deploy.slug || "new"}
          reference={project.reference}
          target={deploy}
          onClose={() => setDeploy(null)}
          onDeployed={setSelected}
        />
      )}
    </div>
  );
}

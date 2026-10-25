import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SupabaseFunctionDeployTarget } from "./supabase-function-deploy-dialog";
import { SupabaseFunctionInvoke } from "./supabase-function-invoke";
import { SupabaseFunctionSettings } from "./supabase-function-settings";
import { SupabaseFunctionSource } from "./supabase-function-source";

export function SupabaseFunctionDetail({
  reference,
  slug,
  cloud,
  hasProjectKey,
  onDeploy,
  onDeleted,
}: {
  reference: string;
  slug: string;
  cloud: boolean;
  hasProjectKey: boolean;
  onDeploy: (target: SupabaseFunctionDeployTarget) => void;
  onDeleted: () => void;
}) {
  return (
    <div className="min-w-0 space-y-4">
      <h3 className="font-mono text-base font-semibold">{slug}</h3>
      <Tabs defaultValue={cloud ? "details" : "invoke"}>
        <TabsList>
          <TabsTrigger
            value="details"
            disabled={!cloud}
            title={cloud ? undefined : "Selbst gehostet nicht verfügbar."}
          >
            Details
          </TabsTrigger>
          <TabsTrigger
            value="source"
            disabled={!cloud}
            title={cloud ? undefined : "Selbst gehostet nicht verfügbar."}
          >
            Code
          </TabsTrigger>
          <TabsTrigger value="invoke">Testen</TabsTrigger>
        </TabsList>
        {cloud && (
          <TabsContent value="details">
            <SupabaseFunctionSettings
              reference={reference}
              slug={slug}
              onDeploy={onDeploy}
              onDeleted={onDeleted}
            />
          </TabsContent>
        )}
        {cloud && (
          <TabsContent value="source">
            <SupabaseFunctionSource reference={reference} slug={slug} />
          </TabsContent>
        )}
        <TabsContent value="invoke">
          <SupabaseFunctionInvoke reference={reference} slug={slug} hasProjectKey={hasProjectKey} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

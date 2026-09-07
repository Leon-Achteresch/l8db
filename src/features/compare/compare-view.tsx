import { GitCompareIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SchemaCopyView } from "@/features/schema-copy/schema-copy-view";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";

import { DataCompareView } from "./data-compare-view";
import { DefinitionCompareView } from "./definition-compare-view";
import { SchemaSnapshotView } from "./schema-snapshot-view";

export function CompareView() {
  const connection = useActiveConnection();
  const snapshotEnabled = supports(connection, "schema_snapshot");
  const dataCompareEnabled = supports(connection, "data_compare");
  const schemaCopyEnabled = supports(connection, "schema_object_copy");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="definitions" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <GitCompareIcon className="size-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Vergleich</span>
          <TabsList className="h-7">
            <TabsTrigger value="definitions" className="text-xs">
              Definitionen
            </TabsTrigger>
            {snapshotEnabled && (
              <TabsTrigger value="snapshot" className="text-xs">
                Metadaten-Snapshot
              </TabsTrigger>
            )}
            {dataCompareEnabled && (
              <TabsTrigger value="data" className="text-xs">
                Tabellendaten
              </TabsTrigger>
            )}
            {schemaCopyEnabled && (
              <TabsTrigger value="schema-copy" className="text-xs">
                Schema-Kopie
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="definitions" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DefinitionCompareView />
        </TabsContent>
        {snapshotEnabled && (
          <TabsContent value="snapshot" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SchemaSnapshotView />
          </TabsContent>
        )}
        {dataCompareEnabled && (
          <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DataCompareView />
          </TabsContent>
        )}
        {schemaCopyEnabled && (
          <TabsContent value="schema-copy" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SchemaCopyView />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

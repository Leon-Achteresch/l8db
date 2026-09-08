import { CameraIcon, CopyIcon, FileCodeIcon, GitCompareIcon, TableIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompareSetupModal } from "@/features/compare/compare-setup-modal";
import {
  type DataCompareSideSelection,
  EMPTY_DATA_SIDE,
} from "@/features/compare/data-compare-side-picker";
import { DataCompareView } from "@/features/compare/data-compare-view";
import { DefinitionCompareView } from "@/features/compare/definition-compare-view";
import { SchemaSnapshotView } from "@/features/compare/schema-snapshot-view";
import { SchemaCopyView } from "@/features/schema-copy/schema-copy-view";
import { type CompareSideSelection, EMPTY_COMPARE_SIDE } from "@/lib/compare-types";
import { useActiveConnection } from "@/lib/connections";
import {
  databaseFromConnectionString,
  useActiveDatabase,
  useActiveSchema,
} from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

type CompareTab = "definitions" | "snapshot" | "data" | "schema-copy";

function sourceSide(
  connectionId: string,
  database: string | null,
  schema: string,
  current: CompareSideSelection,
): CompareSideSelection {
  if (current.connectionId === connectionId) {
    return { ...current, connectionId };
  }
  return {
    ...EMPTY_COMPARE_SIDE,
    objectType: current.objectType,
    connectionId,
    database,
    schema,
  };
}

function sourceDataSide(
  connectionId: string,
  database: string | null,
  schema: string,
  current: DataCompareSideSelection,
): DataCompareSideSelection {
  if (current.connectionId === connectionId) {
    return { ...current, connectionId };
  }
  return { ...EMPTY_DATA_SIDE, connectionId, database, schema };
}

export function CompareView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const snapshotEnabled = supports(connection, "schema_snapshot");
  const dataCompareEnabled = supports(connection, "data_compare");
  const schemaCopyEnabled = supports(connection, "schema_object_copy");
  const [tab, setTab] = useState<CompareTab>("definitions");
  const [left, setLeft] = useState<CompareSideSelection>(EMPTY_COMPARE_SIDE);
  const [right, setRight] = useState<CompareSideSelection>(EMPTY_COMPARE_SIDE);
  const [dataLeft, setDataLeft] = useState<DataCompareSideSelection>(EMPTY_DATA_SIDE);
  const [dataRight, setDataRight] = useState<DataCompareSideSelection>(EMPTY_DATA_SIDE);

  useEffect(() => {
    if (!connection) return;
    const fallbackDatabase =
      database ?? databaseFromConnectionString(effectiveConnectionString(connection));
    setLeft((current) => sourceSide(connection.id, fallbackDatabase, schema, current));
    setDataLeft((current) => sourceDataSide(connection.id, fallbackDatabase, schema, current));
  }, [connection, database, schema]);

  useEffect(() => {
    setRight((current) =>
      current.objectType === left.objectType
        ? current
        : { ...current, objectType: left.objectType, objectName: null, objectOid: null },
    );
  }, [left.objectType]);

  const headerVisible = snapshotEnabled || dataCompareEnabled || schemaCopyEnabled;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as CompareTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {headerVisible && (
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
            <GitCompareIcon className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">Vergleich</span>
            <TabsList className="h-7">
              <TabsTrigger value="definitions" className="gap-1 text-xs">
                <FileCodeIcon className="size-3" />
                Definitionen
              </TabsTrigger>
              {snapshotEnabled && (
                <TabsTrigger value="snapshot" className="gap-1 text-xs">
                  <CameraIcon className="size-3" />
                  Metadaten-Snapshot
                </TabsTrigger>
              )}
              {dataCompareEnabled && (
                <TabsTrigger value="data" className="gap-1 text-xs">
                  <TableIcon className="size-3" />
                  Tabellendaten
                </TabsTrigger>
              )}
              {schemaCopyEnabled && (
                <TabsTrigger value="schema-copy" className="gap-1 text-xs">
                  <CopyIcon className="size-3" />
                  Schema-Kopie
                </TabsTrigger>
              )}
            </TabsList>
            {tab === "data" && dataCompareEnabled && (
              <div className="ml-auto">
                <CompareSetupModal
                  mode="data"
                  sourceConnection={connection}
                  left={dataLeft}
                  right={dataRight}
                  onLeftChange={setDataLeft}
                  onRightChange={setDataRight}
                />
              </div>
            )}
          </div>
        )}

        <TabsContent value="definitions" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DefinitionCompareView
            mode="definitions"
            sourceConnection={connection}
            left={left}
            right={right}
            onLeftChange={setLeft}
            onRightChange={setRight}
          />
        </TabsContent>
        {snapshotEnabled && (
          <TabsContent value="snapshot" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SchemaSnapshotView />
          </TabsContent>
        )}
        {dataCompareEnabled && (
          <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <DataCompareView left={dataLeft} right={dataRight} />
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

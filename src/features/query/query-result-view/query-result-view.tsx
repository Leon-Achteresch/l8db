import { Maximize2, Minimize2 } from "lucide";
import { EyeIcon, LayoutListIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TableDetailTabBar } from "@/features/table/table-detail-tab-bar";
import type { QueryResult, TableInfo } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import {
  resolveTableDetailTab,
  TABLE_DETAIL_TABS,
  type TableDetailTab,
} from "@/lib/table-detail-tabs";
import { QueryResultColumns } from "./query-result-columns";
import { QueryResultData } from "./query-result-data";
import { QueryResultDefinition } from "./query-result-definition";
import { useQueryResultViewModel } from "./use-query-result-view-model";

const RESULT_TABS = TABLE_DETAIL_TABS.filter((tab) =>
  ["data", "columns", "definition"].includes(tab.id),
);

interface QueryResultViewProps {
  text: string;
  runId: string;
  result: QueryResult;
  tables: TableInfo[];
  statusText: string | null;
  actions: ReactNode;
  maximized: boolean;
  onToggleMaximized: () => void;
  onShowClassic: () => void;
}

export function QueryResultView({
  text,
  runId,
  result,
  tables,
  statusText,
  actions,
  maximized,
  onToggleMaximized,
  onShowClassic,
}: QueryResultViewProps) {
  const model = useQueryResultViewModel({ text, runId, result, tables });
  const activeTab = resolveTableDetailTab(model.detailTab, RESULT_TABS) || "data";
  const { ref: badgeRef, isNew } = useNewFeatureVisibility<HTMLSpanElement>("query.result-view");

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => model.setDetailTab(value as TableDetailTab)}
      className="flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 pl-3 pr-2">
        <span
          ref={badgeRef}
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium"
          title={text}
        >
          <EyeIcon className="size-3.5 text-primary" />
          Temporäre View
          {isNew ? <NewBadge /> : null}
        </span>
        <TableDetailTabBar tabs={RESULT_TABS} activeTab={activeTab} />
        <div className="flex shrink-0 items-center gap-1">
          {statusText && (
            <span className="hidden truncate text-[10px] tabular-nums text-muted-foreground md:inline">
              {statusText}
            </span>
          )}
          {actions}
          <Button
            size="icon-sm"
            variant="ghost"
            title="Klassische Ergebnisansicht (Diagramm, JSON)"
            aria-label="Klassische Ergebnisansicht"
            onClick={onShowClassic}
          >
            <LayoutListIcon className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant={maximized ? "secondary" : "default"}
            className="h-7 gap-1.5 px-3 text-xs"
            aria-pressed={maximized}
            title={maximized ? "Editor wieder einblenden" : "Ergebnis als View vergrößern"}
            onClick={onToggleMaximized}
          >
            <MorphIcon icon={maximized ? Minimize2 : Maximize2} className="size-3.5" />
            {maximized ? "Verkleinern" : "Vergrößern"}
          </Button>
        </div>
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <QueryResultData
          model={model}
          text={text}
          columns={result.columns}
          onShowClassic={onShowClassic}
        />
      </TabsContent>

      <TabsContent value="columns" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <QueryResultColumns
          columns={model.columnDetails}
          origins={model.origins}
          foreignKeys={model.foreignKeys}
          loading={model.metaLoading}
          onOpenTable={(schema, table) =>
            model.handleNavigateToTable(schema, table, undefined, true)
          }
        />
      </TabsContent>

      <TabsContent value="definition" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <QueryResultDefinition text={text} />
      </TabsContent>
    </Tabs>
  );
}

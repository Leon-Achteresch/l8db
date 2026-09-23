import { useCallback, useState } from "react";

import { type ExplainNode, explainQuery } from "@/lib/db";
import { supports } from "@/lib/providers";
import { resolveQueryRunTarget } from "@/lib/query-run-target";
import { useSettingsStore } from "@/lib/settings";
import { requestSqlConfirmation } from "@/lib/sql-confirmation";
import { opensManagedTransaction } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";

import type { QueryViewConnection, QueryWorkspaceState } from "./types";

interface UseExplainPlanParams {
  sql: string;
  selectedSql: string;
  cursorOffset: number;
  connection: QueryViewConnection;
  database: string | null;
  workspace: QueryWorkspaceState;
}

export function useExplainPlan({
  sql,
  selectedSql,
  cursorOffset,
  connection,
  database,
  workspace,
}: UseExplainPlanParams) {
  const [plan, setPlan] = useState<{
    node: ExplainNode;
    analyzed: boolean;
    sql: string;
  } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const handleExplain = useCallback(
    async (analyze: boolean) => {
      const target = resolveQueryRunTarget(
        sql,
        selectedSql,
        cursorOffset,
        workspace.runTarget,
        connection?.kind,
      );
      if (!connection || !supports(connection, "explain") || !target.trim() || planLoading) return;
      if (
        analyze &&
        useSettingsStore.getState().confirmDestructiveQueries &&
        opensManagedTransaction(target, connection.kind) &&
        !(await requestSqlConfirmation({
          connection: connection.name,
          database,
          statements: [
            {
              sql: target,
              reason:
                connection.kind === "postgres"
                  ? "EXPLAIN ANALYZE führt die Änderung aus und rollt sie danach zurück."
                  : "EXPLAIN ANALYZE führt die Änderung wirklich aus.",
            },
          ],
        }))
      )
        return;
      setPlanLoading(true);
      setPlanError(null);
      try {
        const plans = await explainQuery(
          connection.kind,
          effectiveConnectionString(connection),
          target,
          analyze,
          database ?? undefined,
        );
        const node = plans[0]?.Plan;
        if (!node) {
          setPlanError("Kein Ausführungsplan erhalten.");
          setPlan(null);
        } else {
          setPlan({ node, analyzed: analyze, sql: target });
        }
      } catch (err) {
        setPlanError(String(err));
        setPlan(null);
      } finally {
        setPlanLoading(false);
      }
    },
    [connection, sql, selectedSql, cursorOffset, workspace.runTarget, database, planLoading],
  );

  return { plan, setPlan, planError, setPlanError, planLoading, handleExplain };
}

export type ExplainPlanState = ReturnType<typeof useExplainPlan>;

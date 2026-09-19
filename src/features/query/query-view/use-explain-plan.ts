import { useCallback, useState } from "react";

import { type ExplainNode, explainQuery } from "@/lib/db";
import { resolveQueryRunTarget } from "@/lib/query-run-target";
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
      if (!connection || !target.trim() || planLoading) return;
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

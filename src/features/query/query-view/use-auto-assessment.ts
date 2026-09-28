import { type RefObject, useEffect, useRef } from "react";

import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { explainQuery } from "@/lib/db";
import { normalizeExplainResult } from "@/lib/explain-normalize";
import type { Json } from "@/lib/extensions/contracts";
import { summarizeExplainPlan } from "@/lib/extensions/plan-summary";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";
import { supports } from "@/lib/providers";
import { resolveQueryRunTarget } from "@/lib/query-run-target";
import { effectiveConnectionString } from "@/lib/ssh";

import type { QueryViewConnection, QueryWorkspaceState } from "./types";

const DELAY_MS = 1500;

interface UseAutoAssessmentParams {
  sql: string;
  selectedSql: string;
  cursorOffset: number;
  connection: QueryViewConnection;
  database: string | null;
  workspace: QueryWorkspaceState;
  editorApiRef: RefObject<QueryEditorApi | null>;
}

export function useAutoAssessment({
  sql,
  selectedSql,
  cursorOffset,
  connection,
  database,
  workspace,
  editorApiRef,
}: UseAutoAssessmentParams) {
  const host = useExtensionHost();
  const command = useExtensionSnapshot((manager) => {
    const enabled = new Set(
      manager
        .listExtensions()
        .filter((item) => item.enabled)
        .map((item) => item.archive.manifest.id),
    );
    return manager.commands.menusFor("editor/plan").find((item) => enabled.has(item.owner))
      ?.command;
  });
  const lastKey = useRef("");
  const runId = useRef(0);

  useEffect(() => {
    if (!command || !connection || !supports(connection, "explain")) return;
    const target = resolveQueryRunTarget(
      sql,
      selectedSql,
      cursorOffset,
      workspace.runTarget,
      connection.kind,
    ).trim();
    const key = `${connection.id}\u0000${database ?? ""}\u0000${target}`;
    if (!target || key === lastKey.current) return;
    const timer = setTimeout(async () => {
      lastKey.current = key;
      const id = ++runId.current;
      try {
        const node = normalizeExplainResult(
          await explainQuery(
            connection.kind,
            effectiveConnectionString(connection),
            target,
            false,
            database ?? undefined,
          ),
        );
        if (!node || id !== runId.current) return;
        const result = await host.executeCommand(command, {
          ...summarizeExplainPlan(node, false),
          auto: true,
        } as unknown as Json);
        if (result !== undefined && id === runId.current)
          editorApiRef.current?.showAssessment(target, result);
      } catch {
        if (id === runId.current) editorApiRef.current?.showAssessment(target, null);
      }
    }, DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    command,
    connection,
    database,
    sql,
    selectedSql,
    cursorOffset,
    workspace.runTarget,
    host,
    editorApiRef,
  ]);
}

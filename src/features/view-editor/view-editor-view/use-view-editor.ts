import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { listAllColumns, listTables, updateViewDefinition } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { useObjectDraft } from "@/lib/hooks/use-object-draft";
import { useTableViewState } from "@/lib/hooks/use-table-view-state";
import { objectDraftKey } from "@/lib/object-drafts";
import {
  useDetailedColumnsQuery,
  useForeignKeysQuery,
  useSchemasQuery,
  useTableRowCountQuery,
  useTableRowsQuery,
  useViewDefinitionQuery,
} from "@/lib/queries";
import { buildViewDdl } from "@/lib/query-builder";
import { invalidateConnectionQueries } from "@/lib/query-client";
import { approximateRowCount, exactRowCount } from "@/lib/row-count";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { useTableTabs } from "@/lib/table-tabs";
import { tableViewStateKey } from "@/lib/table-view-state";

export function useViewEditor(schema: string, view: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openTab = useTableTabs((state) => state.openTab);
  const { data: foreignKeys } = useForeignKeysQuery(schema, view);
  const rowLimit = useSettingsStore((s) => s.rowLimit);

  const stateKey = tableViewStateKey(connection?.id, database, schema, view);
  const objectKey = `view-editor:${schema}.${view}`;
  const [activeTab, setActiveTab] = useTabState<
    "data" | "columns" | "definition" | "used-by" | "grants"
  >(
    tabStateKey(`view-editor:${connection?.id}:${database}:${schema}.${view}`, "activeTab"),
    "data",
  );
  const [filter, setFilter] = useTableViewState(stateKey, "filter", "");
  const [filterRaw, setFilterRaw] = useTableViewState(stateKey, "filterRaw", false);
  const [sorting, setSorting] = useTableViewState(stateKey, "sorting", []);
  const [page, setPage] = useTableViewState(stateKey, "page", 0);

  const { data, isLoading, isFetching, isError, error, refetch } = useTableRowsQuery(
    schema,
    view,
    filter,
    sorting,
    true,
    page,
    filterRaw,
  );
  const { data: rowCount } = useTableRowCountQuery(
    schema,
    view,
    filter,
    filterRaw,
    data !== undefined || isError,
  );
  const totalCount = exactRowCount(rowCount);
  const countLabel = approximateRowCount(rowCount);

  const { data: columnDetails } = useDetailedColumnsQuery(schema, view);

  const { data: definition, isLoading: defLoading } = useViewDefinitionQuery(
    schema,
    view,
    activeTab === "definition",
  );

  const [savedDraft, setDraft, clearSavedDraft, draftBase] = useObjectDraft(
    objectKey,
    `${schema}.${view}`,
    definition ?? "",
  );
  const draft = draftBase || !definition ? savedDraft : null;
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compileStatus, setCompileStatus] = useState<"idle" | "ok" | "error">("idle");
  const [compileError, setCompileError] = useState<string | null>(null);

  const currentValue = draft ?? definition ?? "";
  const isDirty = draft !== null && draft !== definition;
  const ddl = currentValue ? buildViewDdl(connection?.kind, schema, view, currentValue) : "";

  useEffect(() => {
    setCompileStatus("idle");
    setCompileError(null);
  }, [schema, view, definition]);

  const { data: schemas } = useSchemasQuery();

  const { data: tables } = useQuery({
    queryKey: ["all-tables", connection?.id, database],
    queryFn: () =>
      listTables(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: activeTab === "definition" && Boolean(connection),
  });

  const { data: columns } = useQuery({
    queryKey: ["all-columns", connection?.id, database],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: activeTab === "definition" && Boolean(connection),
    staleTime: 60_000,
  });

  const registry = useMemo(
    () => ({ schemas: schemas ?? [], tables: tables ?? [], columns: columns ?? [] }),
    [schemas, tables, columns],
  );

  const handleFilterChange = (newFilter: string, raw = false) => {
    setFilter(newFilter);
    setFilterRaw(raw);
    setPage(0);
  };

  const handleNavigateToTable = useMemo(() => {
    return (targetSchema: string, targetTable: string, filterWhere?: string) => {
      openTab({ schema: targetSchema, table: targetTable, entityType: "table" });
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: targetSchema, table: targetTable },
        search: filterWhere ? { fkFilter: filterWhere } : {},
      });
    };
  }, [openTab, navigate]);

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      setCompileStatus("idle");
      setCompileError(null);
    },
    [setDraft],
  );

  const handleCopy = async () => {
    await copyText(currentValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setDraft(null);
    setCompileStatus("idle");
    setCompileError(null);
  };

  const handleCompile = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    setCompileError(null);
    try {
      await updateViewDefinition(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        view,
        currentValue,
        true,
        database ?? undefined,
      );
      setCompileStatus("ok");
      toast.success("View-Definition ist valide.");
    } catch (e) {
      setCompileStatus("error");
      setCompileError(String(e));
      toast.error("Kompilierungsfehler.");
    } finally {
      setBusy(false);
    }
  }, [connection, schema, view, currentValue, database]);

  const handleExecute = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await updateViewDefinition(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        view,
        currentValue,
        false,
        database ?? undefined,
      );
      toast.success("View-Definition aktualisiert.");
      setCompileStatus("idle");
      setCompileError(null);
      await invalidateConnectionQueries(queryClient, connection.id);
      clearSavedDraft(currentValue);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [connection, schema, view, currentValue, database, queryClient, clearSavedDraft]);

  return {
    activeTab:
      (activeTab === "grants" && !capabilities.object_grants) ||
      (activeTab === "used-by" && !capabilities.used_by)
        ? "data"
        : activeTab,
    busy,
    capabilities,
    columnDetails,
    compileError,
    compileStatus,
    connection,
    copied,
    currentValue,
    data,
    database,
    ddl,
    defLoading,
    editorStateKey: objectDraftKey(connection?.id ?? "", database, objectKey),
    error,
    filter,
    filterRaw,
    foreignKeys,
    handleChange,
    handleCompile,
    handleCopy,
    handleExecute,
    handleFilterChange,
    handleNavigateToTable,
    handleReset,
    isDirty,
    isError,
    isFetching,
    isLoading,
    page,
    refetch,
    registry,
    rowLimit,
    setActiveTab,
    setPage,
    setSorting,
    sorting,
    stateKey,
    totalCount,
    countLabel,
  };
}

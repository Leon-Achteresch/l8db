import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { copyWithToast } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import { dropTable, getTableDdl, listTableColumnsDetailed, truncateTable } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase, useDbSelectionStore } from "@/lib/db-selection";
import { EMPTY_CSV_IMPORT, useImportWorkspace } from "@/lib/import-workspace";
import { favoriteId, useObjectFavoritesStore } from "@/lib/object-favorites";
import { quoteIdent } from "@/lib/sql-filter/quote";
import { SQL_TEMPLATE_LABELS, type SqlTemplate, templateSql } from "@/lib/sql-templates";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableExportRequest } from "@/lib/table-export-request";
import { useTableTabs } from "@/lib/table-tabs";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import type { EntityConfirmAction } from "./entity-confirm-dialog";

export function useSidebarEntityActions(type: "table" | "view") {
  const [confirmAction, setConfirmAction] = useState<EntityConfirmAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();
  const openTab = useTableTabs((state) => state.openTab);
  const openViewEditorTab = useTableTabs((state) => state.openViewEditorTab);
  const openAlterTableTab = useTableTabs((state) => state.openAlterTableTab);
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const activeConnection = useActiveConnection();
  const caps = useActiveCapabilities();
  const activeDatabase = useActiveDatabase();
  const queryClient = useQueryClient();
  const favorites = useObjectFavoritesStore((state) => state.favorites);
  const toggleObjectFavorite = useObjectFavoritesStore((state) => state.toggle);

  const handleConfirmAction = async () => {
    if (!confirmAction || !activeConnection) return;
    setActionLoading(true);
    try {
      const connStr = effectiveConnectionString(activeConnection);
      const kind = activeConnection.kind;
      if (confirmAction.kind === "drop") {
        await dropTable(
          kind,
          connStr,
          confirmAction.schema,
          confirmAction.name,
          activeDatabase ?? undefined,
        );
      } else {
        await truncateTable(
          kind,
          connStr,
          confirmAction.schema,
          confirmAction.name,
          activeDatabase ?? undefined,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ["tables"] });
      await queryClient.invalidateQueries({ queryKey: ["columns"] });
      await queryClient.invalidateQueries({ queryKey: ["rows"] });
      await queryClient.invalidateQueries({ queryKey: ["count"] });
    } catch (error) {
      toast.error(String(error));
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const selectSql = (itemSchema: string, itemName: string) => {
    const kind = activeConnection?.kind;
    const table = `${itemSchema ? `${quoteIdent(itemSchema, kind)}.` : ""}${quoteIdent(itemName, kind)}`;
    if (kind === "mssql") return `SELECT TOP (100) * FROM ${table}`;
    if (kind === "oracle") return `SELECT * FROM ${table} FETCH FIRST 100 ROWS ONLY`;
    return `SELECT * FROM ${table} LIMIT 100`;
  };

  const handleOpenInEditor = (itemSchema: string, itemName: string) => {
    const id = openQueryTabWithSql(
      caps.query_language === "json"
        ? JSON.stringify({ find: itemName, filter: {} }, null, 2)
        : caps.query_language === "redis"
          ? "SCAN 0 MATCH * COUNT 100"
          : selectSql(itemSchema, itemName),
    );
    navigate({ to: "/query/$id", params: { id } });
  };

  const handleScriptTable = async (itemSchema: string, itemName: string, copy = false) => {
    if (!activeConnection) return;
    try {
      const ddl = await getTableDdl(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        itemSchema,
        itemName,
        activeDatabase ?? undefined,
      );
      if (copy) return await copyWithToast(ddl, "CREATE-Skript");
      const id = openQueryTabWithSql(ddl);
      navigate({ to: "/query/$id", params: { id } });
    } catch (error) {
      toast.error("CREATE-Skript konnte nicht erstellt werden", { description: String(error) });
    }
  };

  const handleCopySql = async (itemSchema: string, itemName: string, template: SqlTemplate) => {
    if (!activeConnection) return;
    const connection = activeConnection;
    try {
      const columns = await queryClient.fetchQuery({
        queryKey: ["columns-detailed", connection.id, activeDatabase, itemSchema, itemName],
        queryFn: () =>
          listTableColumnsDetailed(
            connection.kind,
            effectiveConnectionString(connection),
            itemSchema,
            itemName,
            activeDatabase ?? undefined,
          ),
        staleTime: 5 * 60 * 1000,
      });
      await copyWithToast(
        templateSql(template, itemSchema, itemName, columns, connection.kind),
        SQL_TEMPLATE_LABELS[template],
      );
    } catch (error) {
      toast.error("Spalten konnten nicht geladen werden", { description: String(error) });
    }
  };

  const qualifiedName = (itemSchema: string, itemName: string) =>
    itemSchema && caps.query_language !== "redis" ? `${itemSchema}.${itemName}` : itemName;

  const openEntity = (itemSchema: string, itemName: string) => {
    if (type === "view") return openView(itemSchema, itemName);
    navigate({
      to: "/tables/$schema/$table",
      params: { schema: itemSchema, table: itemName },
      search: { type: "table" },
    });
  };

  const openInNewTab = (itemSchema: string, itemName: string) =>
    type === "view"
      ? openViewEditorTab({ schema: itemSchema, view: itemName })
      : openTab({ schema: itemSchema, table: itemName, entityType: "table" });

  const handleExport = (itemSchema: string, itemName: string) => {
    useTableExportRequest.setState({ request: { schema: itemSchema, table: itemName } });
    navigate({
      to: "/tables/$schema/$table",
      params: { schema: itemSchema, table: itemName },
      search: { type },
    });
  };

  const handleImport = (itemSchema: string, itemName: string) => {
    if (!activeConnection) return;
    useDbSelectionStore.getState().setSchema(activeConnection.id, itemSchema);
    const key = JSON.stringify([activeConnection.id, activeDatabase, itemSchema]);
    const { csv, patchCsv } = useImportWorkspace.getState();
    const draft = csv[key];
    const job = useTasksStore.getState().tasks.find((task) => task.id === draft?.jobId);
    if (!(job && isTaskActive(job)) && draft?.targetTable !== itemName)
      patchCsv(key, { ...EMPTY_CSV_IMPORT, targetTable: itemName });
    navigate({ to: "/import", search: { tab: "csv" } });
  };

  const toggleFavoriteObject = (itemSchema: string, itemName: string) => {
    if (!activeConnection) return;
    toggleObjectFavorite({
      connectionId: activeConnection.id,
      database: activeDatabase ?? null,
      schema: itemSchema,
      name: itemName,
      type: type === "view" ? "view" : "table",
    });
  };

  const isFavorite = (itemSchema: string, itemName: string) =>
    activeConnection
      ? favorites.some(
          (favorite) =>
            favoriteId(favorite) ===
            favoriteId({
              connectionId: activeConnection.id,
              database: activeDatabase ?? null,
              schema: itemSchema,
              name: itemName,
              type: type === "view" ? "view" : "table",
            }),
        )
      : false;

  const handleFocusInErDiagram = (itemSchema: string, itemName: string) => {
    navigate({
      to: "/er-diagram",
      search: { focusSchema: itemSchema, focusTable: itemName, depth: 1 },
    });
  };

  const handleAlterTable = (itemSchema: string, itemName: string) => {
    openAlterTableTab({ schema: itemSchema, table: itemName });
    navigate({
      to: "/alter-table/$schema/$table",
      params: { schema: itemSchema, table: itemName },
    });
  };

  const openView = (itemSchema: string, itemName: string) => {
    openViewEditorTab({
      schema: itemSchema,
      view: itemName,
    });
    navigate({
      to: "/view-editor/$schema/$view",
      params: { schema: itemSchema, view: itemName },
    });
  };

  return {
    confirmAction,
    setConfirmAction,
    actionLoading,
    caps,
    activeDatabase,
    handleConfirmAction,
    handleOpenInEditor,
    handleScriptTable,
    handleCopySql,
    qualifiedName,
    openEntity,
    openInNewTab,
    handleExport,
    handleImport,
    toggleFavoriteObject,
    isFavorite,
    handleFocusInErDiagram,
    handleAlterTable,
    openView,
  };
}

export type SidebarEntityActions = ReturnType<typeof useSidebarEntityActions>;

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { dropTable, getTableDdl, truncateTable } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { favoriteId, useObjectFavoritesStore } from "@/lib/object-favorites";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import type { EntityConfirmAction } from "./entity-confirm-dialog";

export function useSidebarEntityActions(type: "table" | "view") {
  const [confirmAction, setConfirmAction] = useState<EntityConfirmAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const navigate = useNavigate();
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

  const handleOpenInEditor = (itemSchema: string, itemName: string) => {
    const id = openQueryTabWithSql(
      caps.query_language === "json"
        ? JSON.stringify({ find: itemName, filter: {} }, null, 2)
        : caps.query_language === "redis"
          ? "SCAN 0 MATCH * COUNT 100"
          : `SELECT * FROM ${itemSchema}."${itemName}";`,
    );
    navigate({ to: "/query/$id", params: { id } });
  };

  const handleScriptTable = async (itemSchema: string, itemName: string) => {
    if (!activeConnection) return;
    try {
      const ddl = await getTableDdl(
        activeConnection.kind,
        effectiveConnectionString(activeConnection),
        itemSchema,
        itemName,
        activeDatabase ?? undefined,
      );
      const id = openQueryTabWithSql(ddl);
      navigate({ to: "/query/$id", params: { id } });
    } catch (error) {
      toast.error("CREATE-Skript konnte nicht erstellt werden", { description: String(error) });
    }
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
    toggleFavoriteObject,
    isFavorite,
    handleFocusInErDiagram,
    handleAlterTable,
    openView,
  };
}

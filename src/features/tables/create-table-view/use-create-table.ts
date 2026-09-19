import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { emptyColumn } from "@/features/tables/create-table-view/columns";
import { CLICKHOUSE_TYPES, COMMON_TYPES } from "@/features/tables/create-table-view/constants";
import { loadTemplateColumns } from "@/features/tables/create-table-view/load-template-columns";
import { copyText } from "@/lib/clipboard";
import { useActiveConnection } from "@/lib/connections";
import {
  type ColumnDefinition,
  type CreateTableRequest,
  createTable,
  listTables,
  previewCreateTableDdl,
} from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function useCreateTable() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const navigate = useNavigate();

  const [tableName, setTableName] = useState("");
  const [schema, setSchema] = useState(
    activeSchema ?? (connection?.kind === "clickhouse" ? "default" : "public"),
  );
  const [ifNotExists, setIfNotExists] = useState(false);
  const [columns, setColumns] = useState<(ColumnDefinition & { id: number })[]>(() => [
    {
      ...emptyColumn(),
      name: "id",
      data_type: connection?.kind === "clickhouse" ? "UInt64" : "bigserial",
      is_nullable: false,
      is_primary_key: true,
    },
    {
      ...emptyColumn(),
      name: "created_at",
      data_type: connection?.kind === "clickhouse" ? "DateTime" : "timestamptz",
      is_nullable: false,
      default_value: "now()",
    },
  ]);
  const [saving, setSaving] = useState(false);
  const capabilities = useActiveCapabilities();
  const [ddl, setDdl] = useState("");
  const [ddlError, setDdlError] = useState<string | null>(null);
  const [templateTables, setTemplateTables] = useState<string[]>([]);
  const [templateTable, setTemplateTable] = useState("");
  const [templateNotes, setTemplateNotes] = useState<string[]>([]);
  const [loadingTemplate, setLoadingTemplate] = useState(false);

  const incomplete = !tableName.trim() || columns.some((c) => !c.name.trim());

  const request = useMemo<CreateTableRequest>(
    () => ({
      schema: schema.trim() || "public",
      name: tableName.trim(),
      columns: columns.map(({ id: _id, ...rest }) => rest),
      if_not_exists: ifNotExists,
    }),
    [schema, tableName, columns, ifNotExists],
  );

  const connectionString = connection ? effectiveConnectionString(connection) : null;
  const kind = connection?.kind;
  const typeOptions = kind === "clickhouse" ? CLICKHOUSE_TYPES : COMMON_TYPES;

  useEffect(() => {
    if (!kind || !connectionString || incomplete) {
      setDdl("");
      setDdlError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewCreateTableDdl(kind, connectionString, request, database ?? undefined)
        .then((sql) => {
          if (cancelled) return;
          setDdl(sql);
          setDdlError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setDdl("");
          setDdlError(typeof err === "string" ? err : String(err));
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, connectionString, database, request, incomplete]);

  useEffect(() => {
    if (!kind || !connectionString || !capabilities.ddl) {
      setTemplateTables([]);
      return;
    }
    let cancelled = false;
    listTables(kind, connectionString, database ?? undefined, schema.trim() || undefined)
      .then((tables) => {
        if (!cancelled) setTemplateTables(tables.map((t) => t.name));
      })
      .catch(() => {
        if (!cancelled) setTemplateTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, [kind, connectionString, database, schema, capabilities.ddl]);

  const applyTemplate = async (source: string) => {
    if (!kind || !connectionString) return;
    const sourceSchema = schema.trim() || "public";
    setLoadingTemplate(true);
    try {
      const loaded = await loadTemplateColumns(
        kind,
        connectionString,
        database,
        sourceSchema,
        source,
        capabilities,
      );
      if (!loaded) {
        toast.error(`Tabelle "${source}" hat keine übernehmbaren Spalten.`);
        return;
      }
      const { mapped, notes } = loaded;

      setColumns(mapped);
      setTableName("");
      setTemplateNotes(notes);
      toast.success(`Spalten aus "${sourceSchema}.${source}" übernommen. Neuen Namen vergeben.`);
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setLoadingTemplate(false);
    }
  };

  const copyDdl = async () => {
    if (!ddl) return;
    try {
      await copyText(ddl);
      toast.success("SQL kopiert.");
    } catch {
      toast.error("SQL konnte nicht kopiert werden.");
    }
  };

  const addColumn = () => setColumns((prev) => [...prev, emptyColumn()]);

  const removeColumn = (id: number) => setColumns((prev) => prev.filter((c) => c.id !== id));

  const updateColumn = (id: number, patch: Partial<ColumnDefinition>) =>
    setColumns((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const handleCreate = async () => {
    if (!connection) return;
    if (!tableName.trim()) {
      toast.error("Tabellenname ist erforderlich.");
      return;
    }
    if (columns.some((c) => !c.name.trim())) {
      toast.error("Alle Spalten müssen einen Namen haben.");
      return;
    }
    setSaving(true);
    try {
      await createTable(
        connection.kind,
        effectiveConnectionString(connection),
        request,
        database ?? undefined,
      );
      toast.success(`Tabelle "${schema}.${tableName}" erstellt.`);
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setSaving(false);
    }
  };

  return {
    connection,
    navigate,
    tableName,
    setTableName,
    schema,
    setSchema,
    ifNotExists,
    setIfNotExists,
    columns,
    saving,
    ddl,
    ddlError,
    templateTables,
    templateTable,
    setTemplateTable,
    templateNotes,
    loadingTemplate,
    incomplete,
    typeOptions,
    applyTemplate,
    copyDdl,
    addColumn,
    removeColumn,
    updateColumn,
    handleCreate,
  };
}

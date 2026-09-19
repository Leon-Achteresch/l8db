import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { type SavedConnection, useActiveConnection } from "@/lib/connections";
import { listAllColumns } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { monaco } from "@/lib/monaco";
import { useAllSchemaObjectsQuery, useSchemasQuery } from "@/lib/queries";
import { EMPTY_REGISTRY, type SqlObjectRegistry, type SymbolTarget } from "@/lib/sql-intellisense";
import { effectiveConnectionString } from "@/lib/ssh";
import { symbolAt } from "./providers";
import { openSymbolTarget } from "./symbols";

type Navigate = ReturnType<typeof useNavigate>;

interface IntellisenseContext {
  registry: SqlObjectRegistry;
  connection: SavedConnection | null;
  database: string | null;
  queryClient: QueryClient | null;
  navigate: Navigate | null;
}

export let ctx: IntellisenseContext = {
  registry: EMPTY_REGISTRY,
  connection: null,
  database: null,
  queryClient: null,
  navigate: null,
};

export const attached = new WeakSet<monaco.editor.ITextModel>();

const IS_MAC = navigator.platform.toLowerCase().includes("mac");

let gotoModel: monaco.editor.ITextModel | null = null;

export function gotoUri(target: SymbolTarget): monaco.Uri {
  const uri = monaco.Uri.from({ scheme: "l8db", path: "/goto", query: JSON.stringify(target) });
  if (!monaco.editor.getModel(uri)) {
    if (gotoModel && !gotoModel.isDisposed()) gotoModel.dispose();
    gotoModel = monaco.editor.createModel("", undefined, uri);
  }
  return uri;
}

export function attachSqlIntellisense(
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  const model = editor.getModel();
  if (model) attached.add(model);
  const mouse = editor.onMouseUp((e) => {
    if (!(e.event.ctrlKey || e.event.metaKey)) return;
    const ctrlOnMac = IS_MAC && e.event.ctrlKey && !e.event.metaKey;
    if (e.event.rightButton && !ctrlOnMac) return;
    const target = e.target.position;
    if (!model || !target) return;
    const symbol = symbolAt(model, target);
    if (symbol?.target.kind !== "table") return;
    const range = symbol.range;
    setTimeout(() => editor.setSelection(range), 0);
    if (ctrlOnMac) openSymbolTarget(symbol.target);
  });
  const menu = editor.onContextMenu((e) => {
    if (!IS_MAC || !e.event.ctrlKey) return;
    const target = e.target.position;
    if (!model || !target) return;
    if (symbolAt(model, target)?.target.kind === "table") e.event.preventDefault();
  });
  return {
    dispose() {
      mouse.dispose();
      menu.dispose();
      if (model) attached.delete(model);
    },
  };
}

export function useSqlIntellisenseSync(): void {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: objects } = useAllSchemaObjectsQuery();
  const { data: schemas } = useSchemasQuery();
  const { data: columns } = useQuery({
    queryKey: ["all-columns", connection?.id, database],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: Boolean(connection),
    staleTime: 60_000,
  });

  useEffect(() => {
    ctx = {
      registry: {
        schemas: schemas ?? [],
        tables: objects?.tables ?? [],
        views: objects?.views ?? [],
        columns: columns ?? [],
        functions: objects?.functions ?? [],
        procedures: objects?.procedures ?? [],
      },
      connection,
      database,
      queryClient,
      navigate,
    };
  }, [connection, database, queryClient, navigate, objects, schemas, columns]);
}

import { fetchTableRows, getFunctionDefinition } from "@/lib/db";
import { packageOid, parsePlsqlMembers } from "@/lib/plsql";
import type { HoverExtras, SymbolTarget } from "@/lib/sql-intellisense";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { ctx } from "./context";

async function fetchDefinition(oid: string): Promise<string> {
  const { connection, database, queryClient } = ctx;
  if (!connection || !queryClient) return "";
  return queryClient.fetchQuery({
    queryKey: ["function-definition", connection.id, database, oid],
    queryFn: () =>
      getFunctionDefinition(
        connection.kind,
        effectiveConnectionString(connection),
        oid,
        database ?? undefined,
      ),
  });
}

export async function packageMembers(schema: string, name: string) {
  try {
    return parsePlsqlMembers(await fetchDefinition(packageOid(schema, name, "spec")));
  } catch {
    return [];
  }
}

export async function hoverExtras(target: SymbolTarget): Promise<HoverExtras> {
  const { connection, database, registry } = ctx;
  if (target.kind === "package") {
    return { members: await packageMembers(target.schema, target.name) };
  }
  if (target.kind === "function" || target.kind === "procedure") {
    const pool = target.kind === "function" ? registry.functions : registry.procedures;
    return { routine: pool.find((fn) => fn.oid === target.oid) };
  }
  if (target.kind === "table" && !target.column && connection) {
    try {
      const rows = await fetchTableRows(
        connection.kind,
        effectiveConnectionString(connection),
        target.schema,
        target.name,
        undefined,
        5,
        0,
        database ?? undefined,
        undefined,
        target.entityType === "view",
      );
      return { rows };
    } catch {
      return {};
    }
  }
  return {};
}

export function openSymbolTarget(target: SymbolTarget): void {
  const { navigate } = ctx;
  if (!navigate) return;
  const tabs = useTableTabs.getState();
  if (target.kind === "table" && target.sql) {
    const id = tabs.openQueryTabWithSql(target.sql, target.name, true);
    void navigate({ to: "/query/$id", params: { id } });
    return;
  }
  if (target.kind === "table") {
    tabs.openTab({ schema: target.schema, table: target.name, entityType: target.entityType });
    void navigate({
      to: "/tables/$schema/$table",
      params: { schema: target.schema, table: target.name },
      search: {
        type: target.entityType === "view" ? ("view" as const) : undefined,
        column: target.column,
      },
    });
    return;
  }
  if (target.kind === "function") {
    tabs.openFunctionTab({ schema: target.schema, name: target.name, oid: target.oid });
    void navigate({
      to: "/functions/$schema/$name",
      params: { schema: target.schema, name: target.name },
      search: { oid: target.oid },
    });
    return;
  }
  if (target.kind === "procedure") {
    tabs.openProcedureTab({ schema: target.schema, name: target.name, oid: target.oid });
    void navigate({
      to: "/procedures/$schema/$name",
      params: { schema: target.schema, name: target.name },
      search: { oid: target.oid },
    });
    return;
  }
  if (target.kind === "package") {
    tabs.openPackageTab({ schema: target.schema, name: target.name });
    void navigate({
      to: "/packages/$schema/$name",
      params: { schema: target.schema, name: target.name },
      search: { part: "body", member: target.member },
    });
  }
}

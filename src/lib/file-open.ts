import { toast } from "sonner";
import { type ConnectionInput, useConnectionsStore } from "@/lib/connections";
import type { OpenFileAction } from "@/lib/db";
import { openSqlPathAsTab } from "@/lib/hooks/use-query-file";
import { openNotebook } from "@/lib/notebook/actions";
import { providerForKind } from "@/lib/providers";
import { sqlFileTitle } from "@/lib/sql-file";
import { activateConnectionWithToast } from "@/lib/ssh";

export type OpenFileTarget =
  | { to: "/" }
  | { to: "/notebook" }
  | { to: "/query/$id"; id: string }
  | null;

type ConnectionAction = Extract<OpenFileAction, { action: "connection" }>;

export function temporaryConnectionInput(action: ConnectionAction): ConnectionInput {
  return {
    name: action.name,
    kind: action.kind,
    connectionString: action.path,
    sslMode: "disable",
    ssh: null,
  };
}

async function openConnection(action: ConnectionAction): Promise<boolean> {
  const status = providerForKind(action.kind)?.driver_status;
  if (status && !status.available) {
    toast.error(`${action.name} kann nicht geöffnet werden: ${status.detail}`);
    return false;
  }
  const connection = useConnectionsStore
    .getState()
    .addTemporaryConnection(temporaryConnectionInput(action));
  return activateConnectionWithToast(connection.id);
}

export async function runOpenFileActions(actions: OpenFileAction[]): Promise<OpenFileTarget> {
  const unsupported = actions.filter((action) => action.action === "unsupported");
  if (unsupported.length > 0) {
    toast.error(
      `Dateityp wird nicht unterstützt: ${unsupported.map((action) => sqlFileTitle(action.path)).join(", ")}`,
    );
  }
  let target: OpenFileTarget = null;
  for (const action of actions) {
    if (action.action === "sql") {
      const id = await openSqlPathAsTab(action.path);
      if (id) target = { to: "/query/$id", id };
    } else if (action.action === "notebook") {
      if (await openNotebook(action.path)) target = { to: "/notebook" };
    } else if (action.action === "connection") {
      if (await openConnection(action)) target = { to: "/" };
    }
  }
  return target;
}

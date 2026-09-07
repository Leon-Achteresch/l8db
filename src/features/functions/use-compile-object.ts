import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";

import { useActiveConnection } from "@/lib/connections";
import { type CompileResult, compileObject } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export type CompileObjectType =
  | "function"
  | "procedure"
  | "package_spec"
  | "package_body"
  | "routine";

export type CompileState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; result: CompileResult }
  | { status: "error"; message: string };

export function useCompileObject() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [state, setState] = useState<CompileState>({ status: "idle" });

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const compile = useCallback(
    async (oid: string, objectType: CompileObjectType, label: string) => {
      if (!connection) return;
      setState({ status: "loading" });
      try {
        const result = await compileObject(
          connection.kind,
          effectiveConnectionString(connection),
          oid,
          objectType,
          database ?? undefined,
        );
        setState({ status: "done", result });
        if (result.status === "VALID") {
          toast.success(`${label} kompiliert`, { description: "Status: VALID" });
        } else {
          toast.error(`${label} ist INVALID`, {
            description: result.line ? `Zeile ${result.line}` : (result.message ?? undefined),
          });
        }
        await queryClient.invalidateQueries({ queryKey: ["function-definition"] });
        await queryClient.invalidateQueries({ queryKey: ["functions"] });
        await queryClient.invalidateQueries({ queryKey: ["procedures"] });
        return result;
      } catch (e) {
        const message = String(e);
        setState({ status: "error", message });
        toast.error(`${label} konnte nicht kompiliert werden`, { description: message });
        return undefined;
      }
    },
    [connection, database, queryClient],
  );

  return { compile, state, reset };
}

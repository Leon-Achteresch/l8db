import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";
import { useActiveConnection } from "@/lib/connections";
import { applyPrincipalChange, type PrincipalChange } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

export function useApplyPrincipalChange() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useCallback(
    async (change: PrincipalChange) => {
      if (!connection) return false;
      try {
        await applyPrincipalChange(
          connection.kind,
          effectiveConnectionString(connection),
          change,
          database ?? undefined,
        );
        if (change.action === "drop")
          queryClient.removeQueries({
            queryKey: ["principal-detail", connection.id, database, change.kind, change.name],
          });
        return true;
      } catch (error) {
        toast.error(String(error));
        return false;
      } finally {
        const roots = ["principals", "principal-detail"];
        if (change.kind === "user" && change.action !== "alter") roots.push("schemas");
        await Promise.all(roots.map((root) => queryClient.invalidateQueries({ queryKey: [root] })));
      }
    },
    [connection, database, queryClient],
  );
}

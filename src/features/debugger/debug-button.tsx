import { Bug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import type { DebugContext } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";
import { DebugDialog } from "./debug-dialog";

export interface DebugButtonProps {
  oid: string;
  schema: string;
  name: string;
  objectType: "function" | "procedure" | "package_body";
  member?: string;
  memberKind?: "FUNCTION" | "PROCEDURE";
}

export function DebugButton(props: DebugButtonProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const [context, setContext] = useState<DebugContext>();
  if (!connection) return null;
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        disabled={
          !props.oid ||
          connection.readOnly ||
          (props.objectType === "package_body" && !props.member)
        }
        onClick={() => {
          try {
            setContext({
              kind: connection.kind,
              connectionString: effectiveConnectionString(connection),
              database: database ?? undefined,
            });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <Bug className="size-3.5" />
        Debuggen
      </Button>
      {context ? (
        <DebugDialog {...props} context={context} onClose={() => setContext(undefined)} />
      ) : null}
    </>
  );
}

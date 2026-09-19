import { Bug } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
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
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen(true)}
      >
        <Bug className="size-3.5" />
        Debuggen
      </Button>
      {open ? (
        <DebugDialog
          {...props}
          context={{
            kind: connection.kind,
            connectionString: effectiveConnectionString(connection),
            database: database ?? undefined,
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { workbenchScope } from "@/lib/workbench/records";
import { InvestigationsDialogButton } from "./investigations-dialog-button";

export function InvestigationsButton() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return <InvestigationsDialogButton key={workbenchScope(connection?.id ?? "", database)} />;
}

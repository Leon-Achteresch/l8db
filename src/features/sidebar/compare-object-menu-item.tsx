import { useNavigate } from "@tanstack/react-router";
import { GitCompareIcon } from "lucide-react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import {
  type CompareObjectType,
  EMPTY_COMPARE_SIDE,
  supportedCompareObjectTypes,
} from "@/lib/compare-types";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { useTableTabs } from "@/lib/table-tabs";

interface CompareObjectMenuItemProps {
  schema: string;
  name: string;
  objectType: CompareObjectType;
  oid?: string;
  identityArgs?: string;
}

export function CompareObjectMenuItem({
  schema,
  name,
  objectType,
  oid,
  identityArgs,
}: CompareObjectMenuItemProps) {
  const navigate = useNavigate();
  const connection = useActiveConnection();
  const database = useActiveDatabase();

  if (!connection || !supportedCompareObjectTypes(connection).includes(objectType)) return null;

  const objectName =
    objectType === "routine" || objectType === "procedure"
      ? `${name}(${identityArgs ?? ""})`
      : name;

  return (
    <ContextMenuItem
      onSelect={() => {
        const id = crypto.randomUUID();
        const tabs = useTableTabs.getState();
        tabs.openToolTab("compare", id);
        tabs.updateCompareTab(
          id,
          {
            left: {
              connectionId: connection.id,
              database,
              schema,
              objectType,
              objectName,
              objectOid:
                objectType === "routine" || objectType === "procedure" ? (oid ?? null) : null,
            },
            right: { ...EMPTY_COMPARE_SIDE, objectType },
            draft: null,
            onlyDifferences: false,
          },
          `Vergleich ${objectName.trim().replace(/\s+/g, "_")}`,
        );
        void navigate({ to: "/compare", search: { compareId: id } });
      }}
    >
      <GitCompareIcon />
      Vergleich erstellen
    </ContextMenuItem>
  );
}

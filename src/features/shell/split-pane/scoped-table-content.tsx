import { TabPaneContent } from "@/features/shell/tab-pane-content";
import { useActiveConnection } from "@/lib/connections";
import { useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { useSchemasQuery } from "@/lib/queries";
import type { TableTab } from "@/lib/table-tabs";

export function ScopedTableContent({ tab }: { tab: TableTab }) {
  const connection = useActiveConnection();
  const schemas = useSchemasQuery();
  const fallbackSchema = useActiveSchema();
  const gated = Boolean(connection) && supports(connection, "schemas") && !schemas.isError;
  if (gated && !schemas.data) {
    return (
      <div role="status" className="p-4 text-sm text-muted-foreground">
        Ansicht wird geladen…
      </div>
    );
  }
  const schema =
    gated && schemas.data && !schemas.data.includes(tab.schema) ? fallbackSchema : tab.schema;
  return <TabPaneContent tab={schema === tab.schema ? tab : { ...tab, schema }} />;
}

import { FileUpIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";

import { CsvImportPanel } from "./csv-import-panel";
import { SqlImportPanel } from "./sql-import-panel";

export function ImportView() {
  const connection = useActiveConnection();
  const csvEnabled = supports(connection, "csv_import");

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="sql" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <FileUpIcon className="size-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Importieren</span>
          <TabsList className="h-7">
            <TabsTrigger value="sql" className="text-xs">
              SQL
            </TabsTrigger>
            {csvEnabled && (
              <TabsTrigger value="csv" className="text-xs">
                CSV
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="sql" className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <SqlImportPanel />
        </TabsContent>
        {csvEnabled && (
          <TabsContent value="csv" className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <CsvImportPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

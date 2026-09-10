import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Table2 } from "lucide-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "@/components/ui/sidebar";
import { QueryResultTable } from "@/features/query/query-result-table";
import { SettingsAppearance } from "@/features/settings/settings-appearance";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { DataTable } from "@/features/table/data-table";
import { initAppearance } from "@/lib/appearance";
import "@/index.css";

initAppearance();
const queryClient = new QueryClient();
const data = Array.from({ length: 3000 }, (_, index) => ({
  name: `ARTIKEL_${index}`,
  value: index,
}));

function App() {
  const [sorting, setSorting] = useState<import("@tanstack/react-table").SortingState>([]);
  return (
    <HotkeysProvider>
      <QueryClientProvider client={queryClient}>
        <div className="bg-background text-foreground p-4">
          <div className="@container space-y-3">
            <SettingsAppearance />
          </div>
          <div className="my-3 flex items-center gap-2">
            <Button data-testid="sample-button">Aktion</Button>
            <Input aria-label="Filter" placeholder="Filter" />
            <Dialog>
              <DialogTrigger asChild>
                <Button>Dialog öffnen</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogTitle>Darstellung prüfen</DialogTitle>
                <DialogDescription>Menüs bleiben erreichbar.</DialogDescription>
                <Select>
                  <SelectTrigger aria-label="Tabelle wählen">
                    <SelectValue placeholder="Tabelle wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="artikel">ARTIKEL</SelectItem>
                    <SelectItem value="rechnung">ABRECHNUNG</SelectItem>
                  </SelectContent>
                </Select>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex gap-4">
            <SidebarProvider className="min-h-0 w-64 shrink-0">
              <div
                data-slot="sidebar-content"
                data-testid="sidebar-scroll"
                className="h-80 w-full overflow-auto"
              >
                <SidebarWindow count={3000}>
                  {(index) => (
                    <SidebarMenuItem key={index} data-index={index}>
                      <SidebarMenuButton>
                        <Table2 />
                        <span>ARTIKEL_{index}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )}
                </SidebarWindow>
              </div>
            </SidebarProvider>
            <div className="h-80 min-w-0 flex-1" data-testid="data-table">
              <DataTable
                className="h-full"
                columns={["name", "value"]}
                data={data}
                emptyMessage="Leer"
                sorting={sorting}
                onSortingChange={setSorting}
              />
            </div>
          </div>
          <div data-testid="query-result" className="mt-4 h-80">
            <QueryResultTable
              result={{
                columns: ["name", "value"],
                rows: data,
                rows_affected: null,
                execution_time_ms: 1,
              }}
              isLoading={false}
              error={null}
            />
          </div>
        </div>
      </QueryClientProvider>
    </HotkeysProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

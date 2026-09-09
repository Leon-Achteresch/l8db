import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import {
  CHARTS,
  type ChartKind,
  createId,
  type Dashboard,
  type Dataset,
  datasetShape,
  emptyDataset,
  settle,
  useDashboardsStore,
} from "@/lib/dashboards";
import { useActiveDatabase } from "@/lib/db-selection";
import { cn } from "@/lib/utils";
import { ChartPalette } from "./chart-palette";
import { DashboardCanvas } from "./dashboard-canvas";
import { DatasetBuilder } from "./dataset-builder";

export function DashboardView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const store = useDashboardsStore();
  const mine = store.dashboards.filter((d) => d.connectionId === connection?.id);
  const activeId = connection ? store.active[connection.id] : undefined;
  const dashboard = mine.find((d) => d.id === activeId) ?? mine[0] ?? null;

  if (!connection)
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <DatabaseIcon className="mx-auto mb-3 size-8 text-muted-foreground/60" />
          <p className="text-sm font-medium">Keine Verbindung aktiv</p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/">Verbindung wählen</Link>
          </Button>
        </div>
      </div>
    );

  if (!dashboard)
    return (
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div>
          <p className="text-sm font-medium">Noch kein Dashboard für {connection.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Erstelle ein Dashboard, baue Datensätze zusammen und platziere Charts.
          </p>
          <Button size="sm" className="mt-3" onClick={() => store.add(connection.id, database)}>
            <PlusIcon /> Dashboard erstellen
          </Button>
        </div>
      </div>
    );

  return (
    <Editor
      key={dashboard.id}
      dashboard={dashboard}
      siblings={mine}
      connectionId={connection.id}
      database={database}
    />
  );
}

function Editor({
  dashboard,
  siblings,
  connectionId,
  database,
}: {
  dashboard: Dashboard;
  siblings: Dashboard[];
  connectionId: string;
  database: string | null;
}) {
  const store = useDashboardsStore();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(
    dashboard.datasets[0]?.id ?? null,
  );
  const [tab, setTab] = useState("data");
  const selected = dashboard.datasets.find((d) => d.id === selectedDatasetId) ?? null;
  const shape = selected ? datasetShape(selected) : null;
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    store.update(dashboard.id, patch);

  const addDataset = () => {
    const ds = emptyDataset(`Datensatz ${dashboard.datasets.length + 1}`);
    update((d) => ({ datasets: [...d.datasets, ds] }));
    setSelectedDatasetId(ds.id);
  };

  const updateDataset = (id: string, patch: Partial<Dataset>) =>
    update((d) => ({ datasets: d.datasets.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  const removeDataset = (id: string) => {
    update((d) => ({
      datasets: d.datasets.filter((x) => x.id !== id),
      widgets: d.widgets.map((w) => (w.datasetId === id ? { ...w, datasetId: null } : w)),
    }));
    setSelectedDatasetId(dashboard.datasets.find((x) => x.id !== id)?.id ?? null);
  };

  const addWidget = (kind: ChartKind) => {
    const size = CHARTS[kind];
    update((d) => ({
      widgets: [
        ...d.widgets,
        settle(
          {
            id: createId(),
            chart: kind,
            datasetId: selectedDatasetId,
            title: "",
            period: "all",
            x: 0,
            y: 0,
            w: size.w,
            h: size.h,
          },
          d.widgets,
        ),
      ],
    }));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(dashboard, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dashboard.name.replace(/[^\w-]+/g, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Dashboard;
      if (!Array.isArray(parsed.widgets) || !Array.isArray(parsed.datasets))
        throw new Error("Ungültiges Format");
      const expertSql = parsed.datasets
        .filter((d) => d.mode === "expert" && d.sql?.trim())
        .map((d) => `${d.name}:\n${d.sql.trim()}`);
      if (
        expertSql.length &&
        !window.confirm(
          `Das Dashboard enthält ${expertSql.length} SQL-Abfrage(n), die nach dem Import direkt auf der Datenbank ausgeführt werden:\n\n${expertSql.join("\n\n")}\n\nImportieren?`,
        )
      )
        return;
      store.importDashboard(parsed, connectionId, database);
      toast.success("Dashboard importiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import fehlgeschlagen");
    }
  };

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      <ResizablePanel
        defaultSize="34%"
        minSize="22%"
        maxSize="55%"
        className="flex min-w-0 flex-col border-r bg-card/40"
      >
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="m-2 grid w-auto grid-cols-2">
            <TabsTrigger value="data">Daten</TabsTrigger>
            <TabsTrigger value="charts">Charts</TabsTrigger>
          </TabsList>
          <TabsContent value="data" className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1.5 border-b px-3 pb-2">
              {dashboard.datasets.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedDatasetId(d.id)}
                  className={cn(
                    "max-w-40 truncate rounded-full border px-2.5 py-1 text-[11px]",
                    d.id === selectedDatasetId
                      ? "border-lime-400 bg-lime-400/15 font-medium"
                      : "hover:bg-muted",
                  )}
                >
                  {d.name}
                </button>
              ))}
              <Button variant="outline" size="xs" onClick={addDataset}>
                <PlusIcon /> Datensatz
              </Button>
            </div>
            {selected ? (
              <DatasetBuilder
                key={selected.id}
                dataset={selected}
                onChange={(patch) => updateDataset(selected.id, patch)}
                onDelete={() => removeDataset(selected.id)}
              />
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Lege einen Datensatz an. Im Einfach-Modus führt dich der Builder Schritt für
                Schritt.
              </div>
            )}
          </TabsContent>
          <TabsContent value="charts" className="min-h-0 flex-1 overflow-y-auto">
            {dashboard.datasets.length > 1 && (
              <div className="px-3 pt-3">
                <Select value={selectedDatasetId ?? ""} onValueChange={setSelectedDatasetId}>
                  <SelectTrigger size="sm" className="h-8 w-full text-xs">
                    <SelectValue placeholder="Datensatz für neue Charts" />
                  </SelectTrigger>
                  <SelectContent>
                    {dashboard.datasets.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <ChartPalette shape={shape} locked={dashboard.locked} onAdd={addWidget} />
          </TabsContent>
        </Tabs>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="66%" className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {siblings.length > 1 && (
            <Select value={dashboard.id} onValueChange={(id) => store.setActive(connectionId, id)}>
              <SelectTrigger size="sm" className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {siblings.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            className="h-8 w-48 text-xs"
            aria-label="Dashboard-Name"
            value={dashboard.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          <div className="ml-auto flex items-center gap-1">
            <Select
              value={String(dashboard.refreshSec)}
              onValueChange={(v) => update({ refreshSec: Number(v) })}
            >
              <SelectTrigger size="sm" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="0">Kein Auto-Refresh</SelectItem>
                <SelectItem value="30">Alle 30 s</SelectItem>
                <SelectItem value="60">Jede Minute</SelectItem>
                <SelectItem value="300">Alle 5 Minuten</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Alle Charts neu laden"
              onClick={() => void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] })}
            >
              <RefreshCwIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={dashboard.locked ? "Layout entsperren" : "Layout sperren"}
              onClick={() => update({ locked: !dashboard.locked })}
            >
              {dashboard.locked ? <LockIcon /> : <LockOpenIcon />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Neues Dashboard"
              onClick={() => store.add(connectionId, database)}
            >
              <PlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dashboard duplizieren"
              onClick={() => store.duplicate(dashboard.id)}
            >
              <CopyIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Exportieren" onClick={exportJson}>
              <DownloadIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Importieren"
              onClick={() => fileInput.current?.click()}
            >
              <UploadIcon />
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                void importJson(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dashboard löschen"
              onClick={() => {
                if (window.confirm(`Dashboard „${dashboard.name}“ löschen?`))
                  store.remove(dashboard.id);
              }}
            >
              <Trash2Icon />
            </Button>
          </div>
        </header>
        <div className="workspace-canvas relative min-h-0 flex-1 overflow-y-auto">
          <DashboardCanvas dashboardId={dashboard.id} selectedDatasetId={selectedDatasetId} />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

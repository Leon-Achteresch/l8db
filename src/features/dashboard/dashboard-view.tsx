import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CopyIcon,
  DatabaseIcon,
  DownloadIcon,
  EyeIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  confirmExpertSql,
  fileLabel,
  fileStamp,
  parseDashboard,
  pickDashboardFile,
  pickDashboardTarget,
  readDashboardFile,
  writeDashboardFile,
} from "@/lib/dashboard-file";
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

async function openDashboardFromFile(connectionId: string, database: string | null) {
  try {
    const path = await pickDashboardFile();
    if (!path) return;
    const { dashboard, stamp } = await readDashboardFile(path);
    if (!confirmExpertSql(dashboard)) return;
    useDashboardsStore
      .getState()
      .importDashboard(
        { ...dashboard, locked: true, filePath: path, fileStamp: stamp },
        connectionId,
        database,
      );
    toast.success(`Dashboard aus ${fileLabel(path)} geladen`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Datei konnte nicht geladen werden");
  }
}

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
          <div className="mt-3 flex justify-center gap-2">
            <Button size="sm" onClick={() => store.add(connection.id, database)}>
              <PlusIcon /> Dashboard erstellen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void openDashboardFromFile(connection.id, database)}
            >
              <FolderOpenIcon /> Aus Datei öffnen
            </Button>
          </div>
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
  const editing = !dashboard.locked;
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
      const parsed = parseDashboard(await file.text());
      if (!confirmExpertSql(parsed)) return;
      store.importDashboard(parsed, connectionId, database);
      toast.success("Dashboard importiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import fehlgeschlagen");
    }
  };

  const path = dashboard.filePath ?? null;

  const reloadFile = useCallback(
    async (auto: boolean) => {
      if (!path) return;
      try {
        const stamp = await fileStamp(path);
        const current = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboard.id);
        if (!current || current.fileStamp === stamp) {
          if (!auto) toast.success("Dashboard ist aktuell");
          return;
        }
        if (!current.locked) {
          toast.warning(`${fileLabel(path)} wurde geändert`, {
            action: { label: "Neu laden", onClick: () => void reloadFile(false) },
          });
          return;
        }
        const { dashboard: parsed } = await readDashboardFile(path);
        if (!confirmExpertSql(parsed)) return;
        store.update(dashboard.id, {
          name: parsed.name,
          datasets: parsed.datasets,
          widgets: parsed.widgets,
          refreshSec: parsed.refreshSec,
          fileStamp: stamp,
        });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
        toast.success(`${fileLabel(path)} neu geladen`);
      } catch (error) {
        if (!auto)
          toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden");
      }
    },
    [path, dashboard.id, store, queryClient],
  );

  useEffect(() => {
    if (!path) return;
    void reloadFile(true);
    const onFocus = () => void reloadFile(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [path, reloadFile]);

  const saveToFile = async () => {
    try {
      const target = path ?? (await pickDashboardTarget(dashboard.name));
      if (!target) return;
      const stamp = await writeDashboardFile(target, dashboard);
      store.update(dashboard.id, { filePath: target, fileStamp: stamp });
      toast.success(`In ${fileLabel(target)} gespeichert`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Speichern fehlgeschlagen");
    }
  };

  return (
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
      {editing && (
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
                    <SelectContent searchable>
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
      )}
      {editing && <ResizableHandle />}
      <ResizablePanel defaultSize="66%" className="flex min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          {siblings.length > 1 && (
            <Select value={dashboard.id} onValueChange={(id) => store.setActive(connectionId, id)}>
              <SelectTrigger size="sm" className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent searchable>
                {siblings.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {editing ? (
            <Input
              className="h-8 w-48 text-xs"
              aria-label="Dashboard-Name"
              value={dashboard.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          ) : (
            <span className="truncate text-xs font-medium">{dashboard.name}</span>
          )}
          {path && (
            <span
              title={path}
              className="max-w-56 truncate rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {fileLabel(path)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Alle Charts neu laden"
              onClick={() => {
                void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
                void reloadFile(false);
              }}
            >
              <RefreshCwIcon />
            </Button>
            {editing && (
              <>
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Exportieren"
                  onClick={exportJson}
                >
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={path ? "In Datei speichern" : "Mit Datei verknüpfen"}
                  onClick={() => void saveToFile()}
                >
                  <SaveIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Dashboard aus Datei öffnen"
                  onClick={() => void openDashboardFromFile(connectionId, database)}
                >
                  <FolderOpenIcon />
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
              </>
            )}
            <Button
              variant={editing ? "default" : "outline"}
              size="xs"
              aria-label={editing ? "Zur Ansicht wechseln" : "Dashboard bearbeiten"}
              onClick={() => update({ locked: editing })}
            >
              {editing ? (
                <>
                  <EyeIcon /> Ansicht
                </>
              ) : (
                <>
                  <PencilIcon /> Bearbeiten
                </>
              )}
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

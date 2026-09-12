import { useQueryClient } from "@tanstack/react-query";
import {
  CopyIcon,
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
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowNavigation } from "@/components/workflow-navigation";
import {
  confirmExpertSql,
  fileLabel,
  fileStamp,
  parseDashboard,
  pickDashboardTarget,
  readDashboardFile,
  writeDashboardFile,
} from "@/lib/dashboard-file";
import { type Dashboard, type Dataset, emptyDataset, useDashboardsStore } from "@/lib/dashboards";
import { ChartWorkspace } from "./chart-workspace";
import { DashboardCanvas } from "./dashboard-canvas";
import { openDashboardFromFile } from "./dashboard-files";
import { DatasetBuilder } from "./dataset-builder";
export function DashboardEditor({
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
  const [selectedWidgetId, setSelectedWidgetId] = useState<string>();
  const editing = !dashboard.locked;
  const selected =
    dashboard.datasets.find((d) => d.id === selectedDatasetId) ?? dashboard.datasets[0] ?? null;

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
    <div className="flex min-h-0 flex-1 flex-col">
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
          <IconButton
            variant="ghost"
            size="icon-sm"
            aria-label="Alle Charts neu laden"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
              void reloadFile(false);
            }}
          >
            <RefreshCwIcon />
          </IconButton>
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
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Neues Dashboard"
                onClick={() => store.add(connectionId, database)}
              >
                <PlusIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Dashboard duplizieren"
                onClick={() => store.duplicate(dashboard.id)}
              >
                <CopyIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Exportieren"
                onClick={exportJson}
              >
                <DownloadIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Importieren"
                onClick={() => fileInput.current?.click()}
              >
                <UploadIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label={path ? "In Datei speichern" : "Mit Datei verknüpfen"}
                onClick={() => void saveToFile()}
              >
                <SaveIcon />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Dashboard aus Datei öffnen"
                onClick={() => void openDashboardFromFile(connectionId, database)}
              >
                <FolderOpenIcon />
              </IconButton>
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
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Dashboard löschen"
                onClick={() => {
                  if (window.confirm(`Dashboard „${dashboard.name}“ löschen?`))
                    store.remove(dashboard.id);
                }}
              >
                <Trash2Icon />
              </IconButton>
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
      <WorkflowNavigation
        value={editing ? tab : "read"}
        onChange={(value) => {
          if (value === "read") update({ locked: true });
          else {
            update({ locked: false });
            setTab(value);
          }
        }}
        items={[
          {
            value: "data",
            label: "Daten",
            description: "Quellen & Datensätze",
            count: dashboard.datasets.length,
          },
          {
            value: "charts",
            label: "Charts",
            description: "Daten visualisieren",
            count: dashboard.widgets.length,
          },
          { value: "layout", label: "Dashboard", description: "Anordnen & Größe" },
          { value: "read", label: "Read-only", description: "Dashboard ansehen" },
        ]}
      />
      {editing && tab === "data" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
            <Select value={selected?.id ?? ""} onValueChange={setSelectedDatasetId}>
              <SelectTrigger aria-label="Datensatz auswählen" className="w-60">
                <SelectValue placeholder="Datensatz auswählen" />
              </SelectTrigger>
              <SelectContent searchable>
                {dashboard.datasets.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={addDataset}>
              <PlusIcon /> Datensatz hinzufügen
            </Button>
            {selected && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const ds = {
                    ...structuredClone(selected),
                    id: crypto.randomUUID(),
                    name: `${selected.name} (Kopie)`,
                  };
                  update((d) => ({ datasets: [...d.datasets, ds] }));
                  setSelectedDatasetId(ds.id);
                }}
              >
                <CopyIcon /> Als neuen Datensatz verwenden
              </Button>
            )}
            <Button
              className="ml-auto"
              size="sm"
              disabled={!selected}
              onClick={() => setTab("charts")}
            >
              Weiter zu Charts →
            </Button>
          </div>
          {selected ? (
            <DatasetBuilder
              key={selected.id}
              dataset={selected}
              onChange={(patch) => updateDataset(selected.id, patch)}
              onDelete={() => {
                if (
                  window.confirm(
                    `Datensatz „${selected.name}“ löschen? Zugeordnete Charts verlieren ihre Datenquelle.`,
                  )
                )
                  removeDataset(selected.id);
              }}
            />
          ) : (
            <div className="grid flex-1 place-items-center p-10">
              <div className="max-w-md space-y-3">
                <p className="text-xs text-muted-foreground">Schritt 1 · Daten vorbereiten</p>
                <h2 className="text-xl font-semibold">Welche Daten möchtest du zeigen?</h2>
                <p className="text-sm text-muted-foreground">
                  Starte mit einer Tabelle oder View. Wähle Kennzahlen und Filter ohne SQL. Diesen
                  Datensatz kannst du anschließend in mehreren Charts verwenden.
                </p>
                <Button onClick={addDataset}>
                  <PlusIcon /> Ersten Datensatz anlegen
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : editing && tab === "charts" ? (
        <ChartWorkspace
          initialWidgetId={selectedWidgetId}
          onWidgetChange={setSelectedWidgetId}
          dashboard={dashboard}
          selectedDatasetId={selected?.id ?? null}
          onDatasetChange={setSelectedDatasetId}
          onData={() => setTab("data")}
          onLayout={() => setTab("layout")}
        />
      ) : (
        <>
          {editing && (
            <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold">Dein Dashboard zusammenstellen</h2>
                <p className="text-xs text-muted-foreground">
                  Charts am Griff verschieben und an der unteren rechten Ecke vergrößern.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setTab("charts")}>
                Charts bearbeiten
              </Button>
            </div>
          )}
          <div className="workspace-canvas relative min-h-0 flex-1 overflow-y-auto">
            <DashboardCanvas
              dashboardId={dashboard.id}
              selectedDatasetId={selectedDatasetId}
              onEdit={(id) => {
                setSelectedWidgetId(id);
                setTab("charts");
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

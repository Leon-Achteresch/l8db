import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { type RefObject, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { insertChartFile, pickAndWriteChart } from "@/lib/chart-file";
import { chartSvgMarkup, copyPng, svgToPng } from "@/lib/chart-image";
import { copyText } from "@/lib/clipboard";
import { useDashboardsStore } from "@/lib/dashboards";
import { type ResultChartConfig, resultChartFile } from "@/lib/result-chart";
import type { ResultChartBinding } from "./types";

export function ResultChartActions({
  binding,
  config,
  canvasRef,
}: {
  binding: ResultChartBinding;
  config: ResultChartConfig;
  canvasRef: RefObject<HTMLDivElement | null>;
}) {
  const navigate = useNavigate();
  const all = useDashboardsStore((state) => state.dashboards);
  const dashboards = useMemo(
    () => all.filter((d) => d.connectionId === binding.connectionId),
    [all, binding.connectionId],
  );
  const chartFile = () => resultChartFile(config, binding.sql, binding.kind, binding.name);
  const markup = () => {
    const svg = chartSvgMarkup(canvasRef.current);
    if (!svg) throw new Error("Dieser Diagrammtyp kann nicht als Bild kopiert werden");
    return svg;
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      if ((await action()) === false) return;
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  const addToDashboard = (dashboardId: string | null) => {
    const store = useDashboardsStore.getState();
    if (!binding.connectionId) return;
    const id = dashboardId ?? store.add(binding.connectionId, binding.database, binding.name);
    const target = useDashboardsStore.getState().dashboards.find((d) => d.id === id);
    if (!target) return;
    const { dataset, widget } = insertChartFile(target, chartFile());
    store.update(id, (d) => ({
      datasets: [...d.datasets, dataset],
      widgets: [...d.widgets, widget],
    }));
    store.setActive(binding.connectionId, id);
    toast.success(`Diagramm zu „${target.name}“ hinzugefügt`, {
      action: { label: "Öffnen", onClick: () => void navigate({ to: "/dashboard" }) },
    });
  };
  const canPersist = binding.sqlCapable && Boolean(binding.sql.trim());
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs">
          Diagramm
          <ChevronDownIcon className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => void run(() => copyPng(svgToPng(markup())), "Diagramm als PNG kopiert")}
        >
          Als PNG kopieren
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void run(() => copyText(markup()), "Diagramm als SVG kopiert")}
        >
          Als SVG kopieren
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!canPersist}
          onSelect={() =>
            void run(
              async () => Boolean(await pickAndWriteChart(chartFile())),
              "Diagramm gespeichert",
            )
          }
        >
          Als Chart-Datei speichern…
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!canPersist || !binding.connectionId}>
            Zum Dashboard hinzufügen
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {dashboards.map((dashboard) => (
              <DropdownMenuItem key={dashboard.id} onSelect={() => addToDashboard(dashboard.id)}>
                {dashboard.name}
              </DropdownMenuItem>
            ))}
            {dashboards.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => addToDashboard(null)}>
              Neues Dashboard
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

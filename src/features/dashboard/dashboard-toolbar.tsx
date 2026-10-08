import { useIsFetching } from "@tanstack/react-query";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  EllipsisIcon,
  FolderOpenIcon,
  LibraryIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  TimerIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UndoRedoControls } from "@/components/undo-redo-controls";
import { fileLabel } from "@/lib/dashboard-file";
import {
  type Dashboard,
  type DashboardPaletteMode,
  PERIOD_LABEL,
  type Period,
  redoDashboards,
  undoDashboards,
  useDashboardPalette,
} from "@/lib/dashboards";
import { useHasNewFeatures } from "@/lib/new-features";
import { cn } from "@/lib/utils";

const REFRESH_OPTIONS = [
  ["0", "Manuell"],
  ["30", "Alle 30 s"],
  ["60", "Jede Minute"],
  ["300", "Alle 5 Min."],
] as const;

const WIDGET_PERIOD = "widget";

const TIME = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

export function DashboardToolbar({
  dashboard,
  siblings,
  database,
  editing,
  compact,
  canUndo,
  canRedo,
  hasNew,
  period,
  onPeriod,
  onSelect,
  onCreate,
  onUpdate,
  onNewChart,
  onReload,
  onDrawer,
  onDesign,
}: {
  dashboard: Dashboard;
  siblings: Dashboard[];
  database: string | null;
  editing: boolean;
  compact: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasNew: boolean;
  period: Period | null;
  onPeriod: (period: Period | null) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onUpdate: (patch: Partial<Dashboard>) => void;
  onNewChart: () => void;
  onReload: () => void;
  onDesign: () => void;
  onDrawer: (drawer: "dashboards" | "charts") => void;
}) {
  const hasNewDesign = useHasNewFeatures("dashboard.design.css");
  const paletteMode = useDashboardPalette((s) => s.mode);
  const setPaletteMode = useDashboardPalette((s) => s.setMode);
  const fetching = useIsFetching({ queryKey: ["dashboard-data"] });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (fetching === 0) setUpdatedAt(Date.now());
  }, [fetching]);

  return (
    <div className="dashboard-toolbar flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <div className="flex min-w-0 items-center gap-0.5">
        {editing && !compact && (
          <Input
            className="h-7 w-48 border-transparent bg-transparent px-1.5 text-sm font-semibold shadow-none hover:border-border dark:bg-transparent"
            aria-label="Dashboard-Name"
            value={dashboard.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Dashboard auswählen"
              className={cn(
                "h-7 min-w-0 gap-1 px-1.5 text-sm font-semibold",
                editing && !compact && "w-7 px-0",
              )}
            >
              {!(editing && !compact) && <span className="truncate">{dashboard.name}</span>}
              <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="truncate text-[11px] font-normal text-muted-foreground">
              Dashboards · {database || "Aktive Datenbank"}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={dashboard.id} onValueChange={onSelect}>
              {siblings.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  <span className="truncate">{item.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onCreate}>
              <PlusIcon /> Neues Dashboard
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onDrawer("dashboards")}>
              <FolderOpenIcon /> Dashboards verwalten…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {dashboard.filePath && (
          <span
            title={dashboard.filePath}
            className="ml-1 max-w-48 truncate rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground"
          >
            {fileLabel(dashboard.filePath)}
          </span>
        )}
        {dashboard.mcpId && (
          <span
            title="Über den l8db-MCP von einem KI-Assistenten angelegt. Änderungen werden in beide Richtungen synchronisiert."
            className="ml-1 rounded border border-primary/40 px-1.5 py-0.5 text-[10px] font-medium text-primary"
          >
            MCP
          </span>
        )}
      </div>
      {!compact && (
        <>
          <span className="mx-1 h-5 w-px shrink-0 bg-border" />
          <Select
            value={period ?? WIDGET_PERIOD}
            onValueChange={(value) => onPeriod(value === WIDGET_PERIOD ? null : (value as Period))}
          >
            <SelectTrigger size="sm" aria-label="Zeitraum" className="h-7 gap-1.5 text-xs">
              <CalendarIcon className="size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WIDGET_PERIOD}>Zeitraum je Chart</SelectItem>
              <SelectSeparator />
              {(Object.keys(PERIOD_LABEL) as Period[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {PERIOD_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {editing && (
              <UndoRedoControls
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undoDashboards}
                onRedo={redoDashboards}
              />
            )}
            <div className="flex items-center">
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-label="Jetzt neu laden"
                disabled={fetching > 0}
                onClick={onReload}
              >
                <RefreshCwIcon className={cn(fetching > 0 && "animate-spin")} />
              </IconButton>
              <Select
                value={String(dashboard.refreshSec)}
                onValueChange={(value) => onUpdate({ refreshSec: Number(value) })}
              >
                <SelectTrigger
                  size="sm"
                  aria-label="Automatisch neu laden"
                  className="h-7 gap-1 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:bg-muted dark:bg-transparent"
                >
                  {dashboard.refreshSec > 0 && <TimerIcon className="size-3.5" />}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {REFRESH_OPTIONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {updatedAt && (
              <span className="hidden text-xs tabular-nums text-muted-foreground lg:inline">
                Aktualisiert {TIME.format(updatedAt)}
              </span>
            )}
            <IconButton
              variant="ghost"
              size="icon-sm"
              aria-label="Gespeicherte Charts"
              onClick={() => onDrawer("charts")}
            >
              <LibraryIcon />
            </IconButton>
            <Button variant="outline" size="sm" className="h-7" onClick={onDesign}>
              <PaletteIcon /> Design
              {hasNewDesign && <NewBadge />}
            </Button>
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  onClick={() => onUpdate({ locked: true })}
                >
                  <CheckIcon /> Fertig
                </Button>
                <Button size="sm" className="h-7" onClick={onNewChart}>
                  <PlusIcon /> Chart erstellen
                  {hasNew && <NewBadge />}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-7"
                aria-label="Dashboard bearbeiten"
                onClick={() => onUpdate({ locked: false })}
              >
                <PencilIcon /> Bearbeiten
                {hasNew && <NewBadge />}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="ghost" size="icon-sm" aria-label="Weitere Dashboard-Aktionen">
                  <EllipsisIcon />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onReload}>
                  <RefreshCwIcon /> Jetzt neu laden
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px]">Farben</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={paletteMode}
                  onValueChange={(mode) => setPaletteMode(mode as DashboardPaletteMode)}
                >
                  <DropdownMenuRadioItem value="connection">Verbindungsfarbe</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="vivid">Bunt</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onDrawer("dashboards")}>
                  <FolderOpenIcon /> Dashboards verwalten
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onDrawer("charts")}>
                  <LibraryIcon /> Gespeicherte Charts
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      )}
    </div>
  );
}

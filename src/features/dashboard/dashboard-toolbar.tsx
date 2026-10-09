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
  PresentationIcon,
  RainbowIcon,
  RefreshCwIcon,
  ShapesIcon,
  TimerIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/icon-button";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuRadioItem,
  IconMenuSeparator,
} from "@/components/icon-menu";
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
  BLOCK_HINT,
  BLOCK_LABEL,
  type BlockKind,
  type Dashboard,
  type DashboardPaletteMode,
  PERIOD_LABEL,
  type Period,
  redoDashboards,
  undoDashboards,
  useDashboardPalette,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
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
  onAddBlock,
  onPresent,
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
  onAddBlock: (type: BlockKind) => void;
  onPresent: () => void;
  onReload: () => void;
  onDesign: () => void;
  onDrawer: (drawer: "dashboards" | "charts") => void;
}) {
  const hasNewDesign = useHasNewFeatures("dashboard.design");
  const blocksFeature = useNewFeatureVisibility<HTMLButtonElement>("dashboard.blocks");
  const presentFeature = useNewFeatureVisibility<HTMLButtonElement>("dashboard.present");
  const paletteMode = useDashboardPalette((s) => s.mode);
  const setPaletteMode = useDashboardPalette((s) => s.setMode);
  const fetching = useIsFetching({ queryKey: ["dashboard-data"] });
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (fetching === 0) setUpdatedAt(Date.now());
  }, [fetching]);

  return (
    <div className="dashboard-toolbar @container/toolbar flex h-11 min-w-0 shrink-0 items-center gap-2 overflow-hidden border-b px-3">
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
              <span className="hidden text-xs tabular-nums text-muted-foreground @[1180px]/toolbar:inline">
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
            <Button
              ref={presentFeature.ref}
              variant="ghost"
              size="sm"
              className="h-7"
              aria-label="Präsentieren"
              onClick={onPresent}
            >
              <PresentationIcon />
              <span className="hidden @[1000px]/toolbar:inline">Präsentieren</span>
              {presentFeature.isNew && <NewBadge />}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              aria-label="Design"
              onClick={onDesign}
            >
              <PaletteIcon />
              <span className="hidden @[760px]/toolbar:inline">Design</span>
              {hasNewDesign && <NewBadge />}
            </Button>
            {editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  aria-label="Fertig"
                  onClick={() => onUpdate({ locked: true })}
                >
                  <CheckIcon />
                  <span className="hidden @[700px]/toolbar:inline">Fertig</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={blocksFeature.ref}
                      variant="outline"
                      size="sm"
                      className="h-7"
                      aria-label="Element hinzufügen"
                    >
                      <ShapesIcon />
                      <span className="hidden @[860px]/toolbar:inline">Element</span>
                      {blocksFeature.isNew && <NewBadge />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
                      Inhalte für diese Seite
                    </DropdownMenuLabel>
                    {(Object.keys(BLOCK_LABEL) as BlockKind[]).map((type) => (
                      <DropdownMenuItem key={type} onSelect={() => onAddBlock(type)}>
                        <div className="grid">
                          <span>{BLOCK_LABEL[type]}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {BLOCK_HINT[type]}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
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
            <IconMenu>
              <DropdownMenuTrigger asChild>
                <IconButton variant="ghost" size="icon-sm" aria-label="Weitere Dashboard-Aktionen">
                  <EllipsisIcon />
                </IconButton>
              </DropdownMenuTrigger>
              <IconMenuContent>
                <IconMenuItem
                  icon={<RefreshCwIcon />}
                  label="Jetzt neu laden"
                  onSelect={onReload}
                />
                <IconMenuSeparator />
                <DropdownMenuRadioGroup
                  value={paletteMode}
                  onValueChange={(mode) => setPaletteMode(mode as DashboardPaletteMode)}
                >
                  <IconMenuRadioItem
                    icon={<PaletteIcon />}
                    label="Farben: Verbindungsfarbe"
                    value="connection"
                  />
                  <IconMenuRadioItem icon={<RainbowIcon />} label="Farben: Bunt" value="vivid" />
                </DropdownMenuRadioGroup>
                <IconMenuSeparator />
                <IconMenuItem
                  icon={<FolderOpenIcon />}
                  label="Dashboards verwalten"
                  onSelect={() => onDrawer("dashboards")}
                />
                <IconMenuItem
                  icon={<LibraryIcon />}
                  label="Gespeicherte Charts"
                  onSelect={() => onDrawer("charts")}
                />
              </IconMenuContent>
            </IconMenu>
          </div>
        </>
      )}
    </div>
  );
}

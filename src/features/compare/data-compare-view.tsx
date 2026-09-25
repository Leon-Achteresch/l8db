import { Loader, Play } from "lucide";
import { ClipboardCopyIcon, LoaderIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORY_ICON, CATEGORY_LABEL } from "@/features/compare/data-compare-view/constants";
import { cellText, sideLabel } from "@/features/compare/data-compare-view/lib";
import type { CategoryFilter } from "@/features/compare/data-compare-view/types";
import { useDataCompare } from "@/features/compare/data-compare-view/use-data-compare";
import type { DataDiffCategory, SyncDirection } from "@/lib/data-compare";
import { cn } from "@/lib/utils";
import type { DataCompareSideSelection } from "./data-compare-side-picker";

interface DataCompareViewProps {
  left: DataCompareSideSelection;
  right: DataCompareSideSelection;
}

export function DataCompareView({ left, right }: DataCompareViewProps) {
  const {
    running,
    error,
    state,
    filter,
    setFilter,
    direction,
    setDirection,
    includeDeletes,
    setIncludeDeletes,
    selected,
    leftConnection,
    rightConnection,
    ready,
    runCompare,
    visibleRows,
    script,
    toggleRow,
    copyScript,
    openScript,
  } = useDataCompare(left, right);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void runCompare()} disabled={!ready || running}>
          <MorphIcon
            icon={running ? Loader : Play}
            className={cn("size-3.5", running && "animate-spin")}
          />
          {running ? "Vergleiche…" : "Vergleichen"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Bis zu 1 Million Zeilen und 64 MiB Rohdaten je Seite; gleiche Spaltenstruktur und
          eindeutige Schlüssel erforderlich. Abbruch über die Aufgabenübersicht.
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {running && (
        <div className="flex flex-1 items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <LoaderIcon className="size-4 animate-spin" />
          Tabellen werden geladen…
        </div>
      )}

      {state && (
        <>
          <p className="text-xs text-muted-foreground">
            {state.left.filter || state.right.filter
              ? "Gefilterter Teilvergleich"
              : "Vollständiger Vergleich der gewählten Tabellen"}{" "}
            · Gleiche Zeilen werden nur gezählt.{" "}
            {state.result.detailsTruncated
              ? "Detailansicht begrenzt: Sync-Skript umfasst ausschließlich die angezeigten und ausgewählten Unterschiede."
              : "Alle Unterschiede in der Detailansicht."}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Links {sideLabel(state.left, leftConnection)}</span>
            <span>Rechts {sideLabel(state.right, rightConnection)}</span>
            <span>Die Seiten wurden unabhängig gelesen, kein gemeinsamer Snapshot.</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Schlüssel: {state.keyColumns.join(", ")}</Badge>
            {(["only_left", "only_right", "changed", "equal"] as DataDiffCategory[]).map(
              (category) => {
                const Icon = CATEGORY_ICON[category];
                return (
                  <Badge key={category} variant="secondary" className="gap-1">
                    <Icon className="size-3" />
                    {CATEGORY_LABEL[category]}: {state.result.counts[category]}
                  </Badge>
                );
              },
            )}
            <div className="ml-auto flex items-center gap-2">
              <Label className="text-xs">Filter</Label>
              <Select value={filter} onValueChange={(value) => setFilter(value as CategoryFilter)}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">
                    Alle
                  </SelectItem>
                  {(["only_left", "only_right", "changed", "equal"] as DataDiffCategory[]).map(
                    (category) => {
                      const Icon = CATEGORY_ICON[category];
                      return (
                        <SelectItem key={category} value={category} className="text-xs">
                          <Icon className="size-3.5" />
                          {CATEGORY_LABEL[category]}
                        </SelectItem>
                      );
                    },
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ScrollArea className="max-h-80 rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="w-8 px-2 py-1"></th>
                  <th className="px-2 py-1 text-left font-medium">Kategorie</th>
                  <th className="px-2 py-1 text-left font-medium">Schlüssel</th>
                  <th className="px-2 py-1 text-left font-medium">Unterschiede</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const CategoryIcon = CATEGORY_ICON[row.category];
                  return (
                    <tr key={row.keyText} className="border-t">
                      <td className="px-2 py-1">
                        {row.category !== "equal" && (
                          <Checkbox
                            checked={selected.has(row.keyText)}
                            onCheckedChange={() => toggleRow(row.keyText)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <span className="inline-flex items-center gap-1.5">
                          <CategoryIcon className="size-3.5" />
                          {CATEGORY_LABEL[row.category]}
                        </span>
                      </td>
                      <td className="px-2 py-1 font-mono">
                        {state.keyColumns
                          .map((column) => `${column}=${cellText(row.keyValues[column])}`)
                          .join(", ")}
                      </td>
                      <td className="px-2 py-1 font-mono text-muted-foreground">
                        {row.differences
                          .map(
                            (diff) =>
                              `${diff.column}: ${cellText(diff.left)} → ${cellText(diff.right)}`,
                          )
                          .join(" | ")}
                      </td>
                    </tr>
                  );
                })}
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                      Keine Zeilen in dieser Kategorie.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollArea>

          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs">Richtung</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value as SyncDirection)}
            >
              <SelectTrigger className="h-8 w-64 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left_to_right" className="text-xs">
                  Links nach rechts
                </SelectItem>
                <SelectItem value="right_to_left" className="text-xs">
                  Rechts nach links
                </SelectItem>
              </SelectContent>
            </Select>
            <Label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                checked={includeDeletes}
                onCheckedChange={(value) => setIncludeDeletes(value === true)}
              />
              Nur im Ziel vorhandene Zeilen löschen
            </Label>
            <span className="text-xs text-muted-foreground">
              Ziel: {script?.target ?? "–"} · {script?.insertCount ?? 0} INSERT ·{" "}
              {script?.updateCount ?? 0} UPDATE · {script?.deleteCount ?? 0} DELETE · Schlüssel:{" "}
              {script?.keys.slice(0, 5).join("; ") || "–"}
              {script && script.keys.length > 5 ? " …" : ""}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyScript()}
                disabled={!script?.sql}
              >
                <ClipboardCopyIcon className="size-3.5" />
                Kopieren
              </Button>
              <Button size="sm" variant="outline" onClick={openScript} disabled={!script?.sql}>
                <SquareArrowOutUpRightIcon className="size-3.5" />
                Als Query-Tab
              </Button>
            </div>
          </div>

          {script?.error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {script.error}
            </div>
          )}

          <pre className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
            {script?.sql || "Keine Änderungen ausgewählt."}
          </pre>
          <span className="text-xs text-muted-foreground">
            Das Skript wird nur erzeugt und nie automatisch ausgeführt; UPDATE prüft den erwarteten
            Altstand, DELETE nur bei aktivierter Option.
          </span>
        </>
      )}
    </div>
  );
}

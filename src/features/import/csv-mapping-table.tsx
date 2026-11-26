import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type CsvColumnMapping,
  type ImportTargetColumn,
  INFERRED_TYPE_LABELS,
  type InferredType,
  isRequiredColumn,
  typeMismatch,
} from "@/lib/csv-import";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;
const NO_TARGET = "__skip__";

interface CsvMappingTableProps {
  headers: string[];
  sampleRow: (string | null)[] | undefined;
  mappings: CsvColumnMapping[];
  targets: ImportTargetColumn[];
  inferredTypes?: InferredType[];
  onChange: (csvIndex: number, target: string | null) => void;
}

function targetHint(column: ImportTargetColumn): string {
  const flags: string[] = [column.data_type];
  if (!column.is_nullable) flags.push("NOT NULL");
  if (column.has_default) flags.push("Default");
  if (column.is_identity) flags.push("Identity");
  if (column.is_generated) flags.push("generiert");
  return flags.join(" · ");
}

export function CsvMappingTable({
  headers,
  sampleRow,
  mappings,
  targets,
  inferredTypes = [],
  onChange,
}: CsvMappingTableProps) {
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [page, setPage] = useState(0);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const filterButton = useRef<HTMLButtonElement>(null);
  const filter = useNewFeatureVisibility<HTMLButtonElement>("import.csv.unmapped-filter");
  const byIndex = new Map(mappings.map((mapping) => [mapping.csvIndex, mapping.target]));
  const byName = new Map(targets.map((target) => [target.name, target]));
  const unmapped = headers.flatMap((_, index) => {
    const name = byIndex.get(index);
    return name == null || !byName.has(name) ? [index] : [];
  });
  const count = onlyUnmapped ? unmapped.length : headers.length;
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, count);
  const visible = onlyUnmapped
    ? unmapped.slice(start, end)
    : Array.from({ length: end - start }, (_, i) => start + i);
  const usedTargets = new Set(mappings.map((m) => m.target).filter(Boolean) as string[]);

  return (
    <table className="w-full table-fixed border-collapse text-[13px]">
      <caption className="px-4 py-1 text-left">
        <div className="flex items-center gap-2">
          <Button
            ref={(button) => {
              filterButton.current = button;
              return filter.ref(button);
            }}
            type="button"
            size="xs"
            variant={onlyUnmapped ? "secondary" : "ghost"}
            aria-pressed={onlyUnmapped}
            onClick={() => {
              setOnlyUnmapped(!onlyUnmapped);
              setPage(0);
            }}
          >
            Nur ohne Zielspalte <span className="tabular-nums">{unmapped.length}</span>
            {filter.isNew && <NewBadge />}
          </Button>
          {lastPage > 0 && (
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-muted-foreground tabular-nums">
                {start + 1}–{end} von {count}
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Vorherige Spalten"
                disabled={currentPage === 0}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Nächste Spalten"
                disabled={currentPage === lastPage}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </div>
      </caption>
      <colgroup>
        <col className="w-[22%]" />
        <col />
        <col className="w-8" />
        <col className="w-[30%]" />
        <col className="w-[24%]" />
      </colgroup>
      <thead className="text-xs text-muted-foreground">
        <tr className="border-b">
          <th className="px-4 py-1.5 text-left font-medium">Quellspalte</th>
          <th className="px-2 py-1.5 text-left font-medium">Beispiel</th>
          <th className="w-6" aria-label="Zuordnung" />
          <th className="px-2 py-1.5 text-left font-medium">Zielspalte</th>
          <th className="px-2 py-1.5 pr-4 text-left font-medium">Typ</th>
        </tr>
      </thead>
      <tbody>
        {onlyUnmapped && unmapped.length === 0 && (
          <tr>
            <td colSpan={5} className="px-4 py-3 text-muted-foreground">
              Alle Quellspalten sind zugeordnet.
            </td>
          </tr>
        )}
        {visible.map((index) => {
          const header = headers[index];
          const name = byIndex.get(index);
          const target = name == null ? undefined : byName.get(name);
          const value = name ?? NO_TARGET;
          const sample = sampleRow?.[index] ?? null;
          const inferred = inferredTypes[index];
          const mismatch = Boolean(inferred && target && typeMismatch(inferred, target.data_type));
          return (
            <tr
              key={index}
              className={cn("border-b hover:bg-muted/30", !target && "text-muted-foreground")}
            >
              <td className="truncate px-4 py-1 font-mono">{header}</td>
              <td className="truncate px-2 py-1 font-mono text-muted-foreground">
                {sample === null ? "NULL" : sample === "" ? '""' : sample}
              </td>
              <td className="text-center text-muted-foreground">
                <ArrowRightIcon className="inline size-3.5" />
              </td>
              <td className="px-2 py-1">
                <Select
                  open={openIndex === index}
                  onOpenChange={(open) => setOpenIndex(open ? index : null)}
                  value={value}
                  onValueChange={(next) => {
                    setOpenIndex(null);
                    onChange(index, next === NO_TARGET ? null : next);
                    if (onlyUnmapped && next !== NO_TARGET) filterButton.current?.focus();
                  }}
                >
                  <SelectTrigger
                    aria-label={`Zielspalte für ${header}`}
                    size="sm"
                    className={cn(
                      "h-7 w-full min-w-0 font-mono text-xs",
                      !target && "border-dashed text-muted-foreground",
                    )}
                  >
                    <SelectValue placeholder="Nicht importieren">
                      {target ? target.name : "Nicht importieren"}
                    </SelectValue>
                  </SelectTrigger>
                  {openIndex === index && (
                    <SelectContent searchable>
                      <SelectItem value={NO_TARGET}>Nicht importieren</SelectItem>
                      {targets.map((target) => (
                        <SelectItem
                          key={target.name}
                          value={target.name}
                          disabled={
                            target.is_generated ||
                            (usedTargets.has(target.name) && target.name !== name)
                          }
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-mono">{target.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {targetHint(target)}
                            </span>
                            {isRequiredColumn(target) && (
                              <Badge variant="outline" className="text-[10px]">
                                Pflicht
                              </Badge>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  )}
                </Select>
              </td>
              <td className="px-2 py-1 pr-4">
                <span className="flex min-w-0 items-center gap-2">
                  {target && (
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {target.data_type}
                    </span>
                  )}
                  {inferred && (
                    <Badge
                      variant="outline"
                      className={
                        mismatch
                          ? "border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-600"
                          : "text-[10px] text-muted-foreground"
                      }
                      title={
                        mismatch
                          ? `Erkannter Typ passt eventuell nicht zu ${target?.data_type}`
                          : "Erkannter Typ"
                      }
                    >
                      {INFERRED_TYPE_LABELS[inferred]}
                    </Badge>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

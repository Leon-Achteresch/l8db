import { ChevronDown, ChevronUp } from "lucide";
import { CheckCheckIcon, CopyIcon } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { motion } from "motion/react";
import { Collapse } from "@/components/motion/collapse";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/clipboard";
import type { DetailedColumnInfo } from "@/lib/db";
import { getTypeConfig } from "./column-type-config";

export function ColumnListItem({
  column,
  isExpanded,
  copiedColumn,
  setExpandedColumn,
  setCopiedColumn,
}: {
  column: DetailedColumnInfo;
  isExpanded: boolean;
  copiedColumn: string | null;
  setExpandedColumn: (name: string | null) => void;
  setCopiedColumn: (name: string | null) => void;
}) {
  const dataType =
    column.character_maximum_length != null
      ? `${column.data_type}(${column.character_maximum_length})`
      : column.data_type;

  const typeConfig = getTypeConfig(column.data_type, column.is_primary_key);
  const IconComponent = typeConfig.icon;

  return (
    <motion.div
      layout
      variants={{
        hidden: { opacity: 0, y: 8 },
        visible: { opacity: 1, y: 0 },
      }}
      className={`group flex flex-col rounded-xl border transition-all duration-200 ${
        isExpanded
          ? "border-primary/50 bg-primary/[0.02] shadow-sm"
          : "border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30"
      }`}
    >
      <div
        onClick={() => setExpandedColumn(isExpanded ? null : column.name)}
        className="flex cursor-pointer items-center gap-3 p-3.5"
      >
        <span className="w-5 shrink-0 text-right text-xs font-semibold text-muted-foreground/60 tabular-nums">
          {column.ordinal_position}
        </span>

        <div className={`rounded-lg border p-1.5 shrink-0 ${typeConfig.color}`}>
          <IconComponent className="size-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold tracking-tight text-foreground">
              {column.name}
            </span>
            {column.is_primary_key && (
              <Badge
                variant="outline"
                className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] py-0 px-1.5 shrink-0 font-medium"
              >
                PK
              </Badge>
            )}
            {!column.is_nullable && (
              <Badge
                variant="outline"
                className="bg-muted text-foreground/80 border-border text-[10px] py-0 px-1.5 shrink-0 font-medium"
              >
                NOT NULL
              </Badge>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="font-mono text-xs text-muted-foreground/80 bg-muted/40 px-2 py-0.5 rounded border border-border/50 shrink-0">
            {dataType}
          </span>

          {column.column_default != null && (
            <div className="hidden max-w-[8rem] sm:max-w-[12rem] truncate font-mono text-[10px] text-muted-foreground/60 bg-muted/20 px-1.5 py-0.5 rounded border shrink-0 md:block">
              {column.column_default}
            </div>
          )}

          <div className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0">
            <MorphIcon icon={isExpanded ? ChevronUp : ChevronDown} className="size-4" />
          </div>
        </div>
      </div>

      <Collapse open={isExpanded} durationMs={200}>
        <div className="border-t border-muted/40 bg-muted/10 p-4">
          <div className="grid grid-cols-2 gap-4 text-xs md:grid-cols-4">
            <div className="bg-card border rounded-lg p-2.5">
              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                Position
              </div>
              <div className="font-mono text-foreground font-semibold text-sm">
                {column.ordinal_position}
              </div>
            </div>
            <div className="bg-card border rounded-lg p-2.5">
              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                Datentyp
              </div>
              <div
                className="font-mono text-foreground font-semibold text-sm truncate"
                title={column.data_type}
              >
                {column.data_type}
              </div>
            </div>
            <div className="bg-card border rounded-lg p-2.5">
              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                Nullable
              </div>
              <div className="font-mono text-foreground font-semibold text-sm">
                {column.is_nullable ? "YES" : "NO"}
              </div>
            </div>
            <div className="bg-card border rounded-lg p-2.5">
              <div className="text-muted-foreground text-[10px] font-medium uppercase tracking-wider mb-1">
                Standardwert
              </div>
              <div
                className="font-mono text-foreground font-semibold text-sm truncate"
                title={column.column_default ?? "Keiner"}
              >
                {column.column_default ?? "NULL"}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-muted/30 pt-3">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              Spalte für Abfragen kopieren oder im SQL Editor verwenden
            </span>
            <Button
              size="xs"
              variant="outline"
              className="h-7 gap-1.5 px-2.5 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                copyText(column.name);
                setCopiedColumn(column.name);
                setTimeout(() => setCopiedColumn(null), 1500);
              }}
            >
              {copiedColumn === column.name ? (
                <>
                  <CheckCheckIcon className="size-3.5 text-emerald-500" />
                  Kopiert!
                </>
              ) : (
                <>
                  <CopyIcon className="size-3.5" />
                  Namen kopieren
                </>
              )}
            </Button>
          </div>
        </div>
      </Collapse>
    </motion.div>
  );
}

import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, SquareTerminal, Star, Table2, Workflow, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { describeAtlasTable } from "./atlas-format";
import {
  type AtlasMetric,
  type AtlasNeighbors,
  type AtlasTable,
  splitAtlasKey,
} from "./atlas-layout";

const CHIP_LIMIT = 6;

interface AtlasLensProps {
  table: AtlasTable | null;
  neighbors: AtlasNeighbors;
  metric: AtlasMetric;
  sizesPending: boolean;
  notice: string | null;
  hidden: number;
  matching: number;
  showRelations: boolean;
  showEr: boolean;
  onWalk: (key: string) => void;
  onOpen: (schema: string, name: string) => void;
  onQuery: (schema: string, name: string) => void;
  onClear: () => void;
}

export function AtlasLens({
  table,
  neighbors,
  metric,
  sizesPending,
  notice,
  hidden,
  matching,
  showRelations,
  showEr,
  onWalk,
  onOpen,
  onQuery,
  onClear,
}: AtlasLensProps) {
  if (!table)
    return (
      <p className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {sizesPending
            ? "Größen werden geladen"
            : metric === "bytes"
              ? "Fläche zeigt den Speicher, logarithmisch skaliert"
              : metric === "rows"
                ? "Fläche zeigt die geschätzten Zeilen, logarithmisch skaliert"
                : metric === "links"
                  ? "Keine Größen lesbar (Statistiken oder Leserechte fehlen), Fläche zeigt die Fremdschlüssel"
                  : "Keine Größen lesbar (Statistiken oder Leserechte fehlen), alle Tabellen sind gleich groß"}
        </span>
        {notice && (
          <span title={notice} className="max-w-full truncate text-amber-600 dark:text-amber-400">
            Katalog nur teilweise lesbar: {notice}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-primary" /> geöffnet
        </span>
        <span className="flex items-center gap-1.5">
          <Star className="size-2.5 fill-current text-primary" /> Favorit
        </span>
        {hidden > 0 && (
          <span>
            {metric === "bytes" || metric === "rows"
              ? `Zeigt die ${matching - hidden} größten`
              : `Zeigt ${matching - hidden}`}{" "}
            von {matching.toLocaleString("de-DE")} Tabellen, die Suche grenzt ein
          </span>
        )}
        {showRelations && <span>Fahre über eine Tabelle, um ihre Beziehungen zu sehen</span>}
      </p>
    );

  const { outgoing, incoming } = neighbors;
  const facts = describeAtlasTable(table);

  const chips = (keys: string[]) => (
    <>
      {keys.slice(0, CHIP_LIMIT).map((key) => {
        const [schema, name] = splitAtlasKey(key);
        const foreign = schema !== table.schema;
        return (
          <button
            key={key}
            type="button"
            onClick={() => (foreign ? onOpen(schema, name) : onWalk(key))}
            title={foreign ? `${schema}.${name} öffnen` : `Zu ${name} springen`}
            className="max-w-48 truncate rounded-md px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
          >
            {foreign ? `${schema}.${name}` : name}
          </button>
        );
      })}
      {keys.length > CHIP_LIMIT && (
        <span className="text-[11px] text-muted-foreground">+{keys.length - CHIP_LIMIT}</span>
      )}
    </>
  );

  const relation = (icon: ReactNode, label: string, keys: string[]) =>
    keys.length > 0 && (
      <span className="flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-0.5">
        <span className="mr-1 flex items-center gap-1 text-[11px] text-muted-foreground">
          {icon}
          {label}
        </span>
        {chips(keys)}
      </span>
    );

  return (
    <div className="flex min-h-14 flex-wrap items-start justify-between gap-x-6 gap-y-2">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-3">
          <span className="truncate font-mono text-sm font-semibold">{table.name}</span>
          {facts && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{facts}</span>
          )}
        </p>
        {table.comment && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{table.comment}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
          {relation(<ArrowRight className="size-3" />, "verweist auf", outgoing)}
          {relation(<ArrowLeft className="size-3" />, "referenziert von", incoming)}
          {showRelations && outgoing.length + incoming.length === 0 && (
            <span className="text-[11px] text-muted-foreground">Keine Fremdschlüssel</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => onOpen(table.schema, table.name)}>
          <Table2 className="size-3.5" />
          Öffnen
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onQuery(table.schema, table.name)}>
          <SquareTerminal className="size-3.5" />
          Abfrage
        </Button>
        {showEr && (
          <Button size="sm" variant="ghost" asChild>
            <Link
              to="/er-diagram"
              search={{ focusSchema: table.schema, focusTable: table.name }}
              aria-label={`${table.name} im ER-Diagramm zeigen`}
            >
              <Workflow className="size-3.5" />
              ER
            </Link>
          </Button>
        )}
        <IconButton variant="ghost" size="icon-sm" aria-label="Auswahl aufheben" onClick={onClear}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}

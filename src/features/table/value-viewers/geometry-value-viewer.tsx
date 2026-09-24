import { CopyIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { copyText } from "@/lib/clipboard";
import {
  countPositions,
  type ParsedGeometry,
  toEwkt,
  toGeoJson,
  tryParseGeometry,
} from "@/lib/value-viewers/geometry";
import { GeometryMap, type GeometryMapItem } from "./geometry-map";

const COLUMN_LIMIT = 5000;

const FORMAT_LABELS: Record<ParsedGeometry["format"], string> = {
  wkb: "WKB",
  ewkb: "EWKB",
  mysql: "MySQL-Binärformat",
  mssql: "SQL-Server-Binärformat",
  wkt: "WKT",
  geojson: "GeoJSON",
};

type GeometryValueViewerProps = {
  parsed: ParsedGeometry;
  dataType?: string | null;
  getColumnValues?: () => unknown[];
};

export function GeometryValueViewer({
  parsed,
  dataType,
  getColumnValues,
}: GeometryValueViewerProps) {
  const [mode, setMode] = useState<"map" | "wkt" | "geojson">("map");
  const [wholeColumn, setWholeColumn] = useState(false);
  const wkt = useMemo(() => toEwkt(parsed), [parsed]);
  const geojson = useMemo(() => toGeoJson(parsed.geometry), [parsed]);
  const column = useMemo(() => {
    if (!wholeColumn || !getColumnValues) return null;
    const items: GeometryMapItem[] = [];
    let skipped = 0;
    const values = getColumnValues();
    for (let i = 0; i < values.length && items.length < COLUMN_LIMIT; i++) {
      if (values[i] === null || values[i] === undefined) continue;
      const geometry = tryParseGeometry(values[i], dataType);
      if (geometry) items.push({ geometry: geometry.geometry, label: `Zeile ${i + 1}` });
      else skipped++;
    }
    return { items, skipped, total: values.length };
  }, [wholeColumn, getColumnValues, dataType]);
  const single = useMemo(
    () => [{ geometry: parsed.geometry, label: parsed.geometry.type }],
    [parsed],
  );
  const text = mode === "wkt" ? wkt : geojson;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={mode}
            onValueChange={(next) => next && setMode(next as typeof mode)}
          >
            <ToggleGroupItem value="map">Karte</ToggleGroupItem>
            <ToggleGroupItem value="wkt">WKT</ToggleGroupItem>
            <ToggleGroupItem value="geojson">GeoJSON</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-muted-foreground" data-testid="geometry-info">
            {parsed.geometry.type}
            {parsed.hasZ && " Z"}
            {parsed.hasM && " M"} · SRID {parsed.srid ?? "–"} · {FORMAT_LABELS[parsed.format]} ·{" "}
            {countPositions(parsed.geometry).toLocaleString("de-DE")} Punkte
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {getColumnValues && mode === "map" && (
            <Button
              type="button"
              variant={wholeColumn ? "secondary" : "outline"}
              size="sm"
              onClick={() => setWholeColumn((prev) => !prev)}
            >
              Ganze Spalte
            </Button>
          )}
          {mode !== "map" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                await copyText(text);
                toast.success(`${mode === "wkt" ? "WKT" : "GeoJSON"} kopiert`);
              }}
            >
              <CopyIcon className="size-3.5" />
              Kopieren
            </Button>
          )}
        </div>
      </div>
      {mode === "map" ? (
        <>
          <GeometryMap items={column?.items ?? single} srid={parsed.srid} />
          {column && (
            <span className="text-[11px] text-muted-foreground">
              {column.items.length.toLocaleString("de-DE")} Geometrien aus{" "}
              {column.total.toLocaleString("de-DE")} Zeilen
              {column.skipped > 0 && ` · ${column.skipped} nicht lesbar`}
              {column.items.length >= COLUMN_LIMIT && ` · auf ${COLUMN_LIMIT} begrenzt`}
            </span>
          )}
        </>
      ) : (
        <pre className="h-[45vh] overflow-auto rounded-lg border border-border/80 bg-muted/45 p-4 font-mono text-xs whitespace-pre-wrap break-all shadow-inner">
          {text}
        </pre>
      )}
    </div>
  );
}

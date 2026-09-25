import { LocateFixedIcon, MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type Geometry, geometryBounds, type Position } from "@/lib/value-viewers/geometry";

const W = 800;
const H = 480;
const PADDING = 28;

export type GeometryMapItem = { geometry: Geometry; label: string };

type Shape = { d: string; fill: boolean; label: string };
type MapPoint = { x: number; y: number; label: string };

function ringPath(ring: Position[], close: boolean): string {
  if (!ring.length) return "";
  let d = `M${ring[0][0]} ${ring[0][1]}`;
  for (let i = 1; i < ring.length; i++) d += `L${ring[i][0]} ${ring[i][1]}`;
  return close ? `${d}Z` : d;
}

function collect(geometry: Geometry, label: string, shapes: Shape[], points: MapPoint[]) {
  switch (geometry.type) {
    case "Point":
      if (geometry.coordinates.length)
        points.push({ x: geometry.coordinates[0], y: geometry.coordinates[1], label });
      return;
    case "MultiPoint":
      for (const p of geometry.coordinates) points.push({ x: p[0], y: p[1], label });
      return;
    case "LineString":
      shapes.push({ d: ringPath(geometry.coordinates, false), fill: false, label });
      return;
    case "MultiLineString":
      shapes.push({
        d: geometry.coordinates.map((line) => ringPath(line, false)).join(""),
        fill: false,
        label,
      });
      return;
    case "Polygon":
      shapes.push({
        d: geometry.coordinates.map((ring) => ringPath(ring, true)).join(""),
        fill: true,
        label,
      });
      return;
    case "MultiPolygon":
      shapes.push({
        d: geometry.coordinates
          .flatMap((poly) => poly.map((ring) => ringPath(ring, true)))
          .join(""),
        fill: true,
        label,
      });
      return;
    case "GeometryCollection":
      for (const child of geometry.geometries) collect(child, label, shapes, points);
  }
}

function formatCoordinate(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 1 : abs >= 10 ? 4 : 6;
  return value.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

export function GeometryMap({ items, srid }: { items: GeometryMapItem[]; srid: number | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const { shapes, points, bounds } = useMemo(() => {
    const shapes: Shape[] = [];
    const points: MapPoint[] = [];
    for (const item of items) collect(item.geometry, item.label, shapes, points);
    return { shapes, points, bounds: geometryBounds(items.map((i) => i.geometry)) };
  }, [items]);
  const fit = useMemo(() => {
    if (!bounds) return { k: 1, cx: 0, cy: 0 };
    const dx = bounds.maxX - bounds.minX;
    const dy = bounds.maxY - bounds.minY;
    const kx = dx > 0 ? (W - 2 * PADDING) / dx : Number.POSITIVE_INFINITY;
    const ky = dy > 0 ? (H - 2 * PADDING) / dy : Number.POSITIVE_INFINITY;
    const k = Math.min(kx, ky);
    return {
      k: Number.isFinite(k) ? k : 1,
      cx: (bounds.minX + bounds.maxX) / 2,
      cy: (bounds.minY + bounds.maxY) / 2,
    };
  }, [bounds]);
  const scale = fit.k * view.zoom;
  const toScreen = (x: number, y: number) => ({
    x: W / 2 + view.panX + (x - fit.cx) * scale,
    y: H / 2 + view.panY - (y - fit.cy) * scale,
  });
  const svgPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return { x: W / 2, y: H / 2 };
    return {
      x: ((clientX - rect.left) * W) / rect.width,
      y: ((clientY - rect.top) * H) / rect.height,
    };
  };
  const zoomAt = (factor: number, sx = W / 2, sy = H / 2) =>
    setView((prev) => {
      const zoom = Math.min(1e6, Math.max(0.05, prev.zoom * factor));
      const f = zoom / prev.zoom;
      return {
        zoom,
        panX: sx - W / 2 - f * (sx - W / 2 - prev.panX),
        panY: sy - H / 2 - f * (sy - H / 2 - prev.panY),
      };
    });
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;
  const svgPointRef = useRef(svgPoint);
  svgPointRef.current = svgPoint;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = svgPointRef.current(event.clientX, event.clientY);
      zoomAtRef.current(Math.exp(-event.deltaY * 0.0015), p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);
  if (!bounds)
    return (
      <p className="p-4 text-xs text-muted-foreground italic">
        Geometrie enthält keine Koordinaten.
      </p>
    );
  const transform = `translate(${W / 2 + view.panX} ${H / 2 + view.panY}) scale(${scale} ${-scale}) translate(${-fit.cx} ${-fit.cy})`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative overflow-hidden rounded-lg border border-border/80 bg-muted/30">
        <svg
          ref={svgRef}
          role="img"
          aria-label="Geometrie-Karte"
          data-testid="geometry-map"
          viewBox={`0 0 ${W} ${H}`}
          className="block h-auto w-full cursor-grab touch-none select-none active:cursor-grabbing"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = svgPoint(event.clientX, event.clientY);
          }}
          onPointerMove={(event) => {
            const p = svgPoint(event.clientX, event.clientY);
            setCursor({
              x: fit.cx + (p.x - W / 2 - view.panX) / scale,
              y: fit.cy - (p.y - H / 2 - view.panY) / scale,
            });
            const start = dragRef.current;
            if (!start) return;
            dragRef.current = p;
            setView((prev) => ({
              ...prev,
              panX: prev.panX + p.x - start.x,
              panY: prev.panY + p.y - start.y,
            }));
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerLeave={() => setCursor(null)}
          onDoubleClick={(event) => {
            const p = svgPoint(event.clientX, event.clientY);
            zoomAt(2, p.x, p.y);
          }}
        >
          <defs>
            <pattern id="l8db-geo-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path
                d="M40 0H0V40"
                fill="none"
                className="stroke-border"
                strokeWidth="0.5"
                strokeOpacity="0.6"
              />
            </pattern>
          </defs>
          <rect width={W} height={H} fill="url(#l8db-geo-grid)" />
          <g transform={transform} className="text-primary">
            {shapes.map((shape, index) => (
              <path
                key={index}
                d={shape.d}
                fill={shape.fill ? "currentColor" : "none"}
                fillOpacity={shape.fill ? 0.18 : undefined}
                fillRule="evenodd"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              >
                <title>{shape.label}</title>
              </path>
            ))}
          </g>
          <g className="text-primary">
            {points.map((point, index) => {
              const s = toScreen(point.x, point.y);
              return (
                <circle
                  key={index}
                  cx={s.x}
                  cy={s.y}
                  r={4.5}
                  fill="currentColor"
                  fillOpacity={0.85}
                  className="stroke-background"
                  strokeWidth={1.5}
                >
                  <title>{`${point.label}: ${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}`}</title>
                </circle>
              );
            })}
          </g>
        </svg>
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            title="Vergrößern"
            onClick={() => zoomAt(1.6)}
          >
            <PlusIcon />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            title="Verkleinern"
            onClick={() => zoomAt(1 / 1.6)}
          >
            <MinusIcon />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="outline"
            title="Einpassen"
            onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}
          >
            <LocateFixedIcon />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted-foreground">
        <span data-testid="geometry-bounds">
          {srid !== null ? `SRID ${srid} · ` : ""}x {formatCoordinate(bounds.minX)} …{" "}
          {formatCoordinate(bounds.maxX)} · y {formatCoordinate(bounds.minY)} …{" "}
          {formatCoordinate(bounds.maxY)}
        </span>
        <span>
          {cursor
            ? `${formatCoordinate(cursor.x)}, ${formatCoordinate(cursor.y)}`
            : "Ziehen zum Verschieben · Mausrad zum Zoomen"}
        </span>
      </div>
    </div>
  );
}

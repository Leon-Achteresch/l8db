import { useId } from "react";
import { toNumber } from "@/lib/dashboards";
import { useElementSize } from "@/lib/hooks/use-element-size";
import { type ChartProps, color } from "./chart-utils";
import { curvePath, type Point, scale } from "./svg-geometry";

export function Kpi({ rows, shape, options }: ChartProps) {
  const uid = useId();
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const key = shape.metrics[0]?.key ?? "";
  if (!shape.dimension || rows.length < 2) return null;
  const values = rows.map((r) => toNumber(r[key]));
  const y = scale([Math.min(0, ...values), Math.max(0, ...values)], [height, 4]);
  const points = values.map((v, i): Point => [(i * width) / (values.length - 1), y(v)]);
  const line = curvePath(points, options.curve);
  const stroke = color(options.colorOffset);
  return (
    <div ref={ref} className="h-full w-full">
      {width > 0 && height > 0 && (
        <svg className="chart-surface" width={width} height={height} aria-hidden="true">
          <defs>
            <linearGradient id={`kpi-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <path d={`${line}L${width},${y(0)}L0,${y(0)}Z`} fill={`url(#kpi-fill-${uid})`} />
          <path d={line} fill="none" stroke={stroke} strokeWidth={2} />
        </svg>
      )}
    </div>
  );
}

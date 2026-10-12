import { type AxisLabel, axisTick } from "./chart-utils";
import type { Box } from "./svg-geometry";

export function CartesianAxes({
  box,
  xLabels,
  yLabels,
  gridX = [],
  gridY = [],
  baseline,
}: {
  box: Box;
  xLabels: AxisLabel[];
  yLabels: AxisLabel[];
  gridX?: number[];
  gridY?: number[];
  baseline?: { x?: number; y?: number };
}) {
  return (
    <g fontSize={axisTick.fontSize} fill={axisTick.fill} className="tabular-nums">
      {gridY.map((y) => (
        <line
          key={`gy${y}`}
          x1={box.left}
          x2={box.right}
          y1={y}
          y2={y}
          stroke="var(--dash-grid)"
          shapeRendering="crispEdges"
        />
      ))}
      {gridX.map((x) => (
        <line
          key={`gx${x}`}
          x1={x}
          x2={x}
          y1={box.top}
          y2={box.bottom}
          stroke="var(--dash-grid)"
          shapeRendering="crispEdges"
        />
      ))}
      {baseline?.y !== undefined && (
        <line
          x1={box.left}
          x2={box.right}
          y1={baseline.y}
          y2={baseline.y}
          stroke="var(--dash-axis)"
          shapeRendering="crispEdges"
        />
      )}
      {baseline?.x !== undefined && (
        <line
          x1={baseline.x}
          x2={baseline.x}
          y1={box.top}
          y2={box.bottom}
          stroke="var(--dash-axis)"
          shapeRendering="crispEdges"
        />
      )}
      {yLabels.map((label) => (
        <text
          key={`y${label.pos}`}
          x={box.left - 8}
          y={label.pos}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {label.text}
        </text>
      ))}
      {xLabels.map((label) => (
        <text
          key={`x${label.pos}`}
          x={label.pos}
          y={box.bottom + 16}
          textAnchor={label.anchor ?? "middle"}
        >
          {label.text}
        </text>
      ))}
    </g>
  );
}

import { axisTick } from "./chart-utils";
import type { Box } from "./svg-geometry";

export type AxisLabel = { pos: number; text: string };

export function CartesianAxes({
  box,
  xLabels,
  yLabels,
  gridX = [],
  gridY = [],
}: {
  box: Box;
  xLabels: AxisLabel[];
  yLabels: AxisLabel[];
  gridX?: number[];
  gridY?: number[];
}) {
  return (
    <g fontSize={axisTick.fontSize} fill={axisTick.fill}>
      {gridY.map((y) => (
        <line
          key={`gy${y}`}
          x1={box.left}
          x2={box.right}
          y1={y}
          y2={y}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
      ))}
      {gridX.map((x) => (
        <line
          key={`gx${x}`}
          x1={x}
          x2={x}
          y1={box.top}
          y2={box.bottom}
          stroke="var(--border)"
          strokeDasharray="3 3"
        />
      ))}
      {yLabels.map((label) => (
        <text
          key={`y${label.pos}`}
          x={box.left - 6}
          y={label.pos}
          textAnchor="end"
          dominantBaseline="middle"
        >
          {label.text}
        </text>
      ))}
      {xLabels.map((label) => (
        <text key={`x${label.pos}`} x={label.pos} y={box.bottom + 14} textAnchor="middle">
          {label.text}
        </text>
      ))}
    </g>
  );
}

import type { Box } from "./svg-geometry";

export function TargetLine({
  box,
  pos,
  label,
  horizontal = false,
}: {
  box: Box;
  pos: number;
  label: string;
  horizontal?: boolean;
}) {
  return (
    <g className="dashboard-target" pointerEvents="none">
      <line
        x1={horizontal ? pos : box.left}
        x2={horizontal ? pos : box.right}
        y1={horizontal ? box.top : pos}
        y2={horizontal ? box.bottom : pos}
        stroke="var(--dash-target, var(--foreground))"
        strokeOpacity={0.7}
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      {label && (
        <text
          x={horizontal ? pos + 4 : box.right - 4}
          y={horizontal ? box.top + 10 : pos - 5}
          textAnchor={horizontal ? "start" : "end"}
          fontSize={10}
          fontWeight={500}
          fill="var(--dash-target, var(--foreground))"
          stroke="var(--card)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {label}
        </text>
      )}
    </g>
  );
}

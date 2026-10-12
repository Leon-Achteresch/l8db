import type { ReactNode } from "react";
import type { ChartKind } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

function illustration(kind: ChartKind): ReactNode {
  switch (kind) {
    case "kpi":
      return (
        <>
          <rect x="12" y="15" width="24" height="6" rx="3" opacity="0.25" />
          <rect x="12" y="28" width="56" height="17" rx="4" />
          <path
            d="M85 48 97 39 108 43 121 29 132 33 148 19"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="12" y="53" width="36" height="5" rx="2.5" opacity="0.35" />
        </>
      );
    case "line":
    case "area":
      return (
        <>
          <path d="M12 18H148M12 38H148M12 58H148" stroke="currentColor" opacity="0.1" />
          {kind === "area" && (
            <path
              d="M12 55C25 55 24 33 42 37S64 52 80 30 102 45 118 20 136 30 148 12V62H12Z"
              opacity="0.18"
            />
          )}
          <path
            d="M12 55C25 55 24 33 42 37S64 52 80 30 102 45 118 20 136 30 148 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M12 59C33 59 30 49 48 51S71 36 89 44 112 37 130 40 138 29 148 31"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            opacity="0.4"
          />
        </>
      );
    case "column":
      return (
        <>
          <path d="M12 62H148M12 20H148M12 41H148" stroke="currentColor" opacity="0.12" />
          {[
            { x: 20, h: 23 },
            { x: 47, h: 38 },
            { x: 74, h: 30 },
            { x: 101, h: 49 },
            { x: 128, h: 41 },
          ].map(({ x, h }) => (
            <rect
              key={x}
              x={x}
              y={62 - h}
              width="15"
              height={h}
              rx="3"
              opacity={x === 101 ? 1 : 0.6}
            />
          ))}
        </>
      );
    case "bars":
      return (
        <>
          {[
            { y: 13, w: 114 },
            { y: 28, w: 86 },
            { y: 43, w: 62 },
            { y: 58, w: 36 },
          ].map(({ y, w }) => (
            <g key={y}>
              <rect x="12" y={y} width="12" height="4" rx="2" opacity="0.25" />
              <rect x="32" y={y - 3} width={w} height="10" rx="3" opacity={w === 114 ? 1 : 0.6} />
            </g>
          ))}
        </>
      );
    case "funnel":
      return (
        <>
          <path d="M14 10H146L131 25H29Z" />
          <path d="M30 29H130L116 44H44Z" opacity="0.7" />
          <path d="M45 48H115L101 63H59Z" opacity="0.4" />
        </>
      );
    case "donut":
      return (
        <>
          <circle
            cx="65"
            cy="36"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="11"
            opacity="0.15"
          />
          <circle
            cx="65"
            cy="36"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="11"
            strokeDasharray="86 151"
            transform="rotate(-90 65 36)"
          />
          <circle
            cx="65"
            cy="36"
            r="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="11"
            strokeDasharray="35 151"
            strokeDashoffset="-90"
            transform="rotate(-90 65 36)"
            opacity="0.5"
          />
          <path
            d="M109 24H141M109 36H135M109 48H129"
            stroke="currentColor"
            strokeWidth="5"
            strokeLinecap="round"
            opacity="0.3"
          />
        </>
      );
    case "rings":
      return (
        <>
          {[
            { r: 27, arc: 130 },
            { r: 18, arc: 72 },
            { r: 9, arc: 24 },
          ].map(({ r, arc }) => (
            <g key={r}>
              <circle
                cx="80"
                cy="36"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                opacity="0.1"
              />
              <circle
                cx="80"
                cy="36"
                r={r}
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeDasharray={`${arc} ${r * Math.PI * 2}`}
                strokeLinecap="round"
                transform="rotate(-90 80 36)"
                opacity={r / 27}
              />
            </g>
          ))}
        </>
      );
    case "radar":
      return (
        <>
          <path
            d="M80 7 110 28 99 62H61L50 28ZM80 19 98 31 91 50H69L62 31ZM80 7V62M50 28 99 62M110 28 61 62"
            fill="none"
            stroke="currentColor"
            opacity="0.18"
          />
          <path
            d="M80 14 103 30 91 53 63 58 61 31Z"
            fillOpacity="0.25"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M80 25 93 33 96 58 69 47 54 29Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity="0.5"
          />
        </>
      );
    case "scatter":
      return (
        <>
          <path
            d="M14 9V62H148M14 36H148M80 9V62"
            fill="none"
            stroke="currentColor"
            opacity="0.12"
          />
          {[
            { x: 32, y: 50, r: 4 },
            { x: 49, y: 39, r: 7 },
            { x: 63, y: 46, r: 4 },
            { x: 79, y: 29, r: 5 },
            { x: 103, y: 35, r: 8 },
            { x: 122, y: 17, r: 6 },
            { x: 137, y: 26, r: 4 },
          ].map(({ x, y, r }) => (
            <circle key={x} cx={x} cy={y} r={r} opacity={r === 8 ? 1 : 0.55} />
          ))}
        </>
      );
    case "sankey":
      return (
        <>
          <path
            d="M29 20C79 20 79 47 130 47"
            fill="none"
            stroke="currentColor"
            strokeWidth="14"
            opacity="0.3"
          />
          <path
            d="M29 50C79 50 79 20 130 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            opacity="0.55"
          />
          <path
            d="M29 19C79 19 79 19 130 19"
            fill="none"
            stroke="currentColor"
            strokeWidth="9"
            opacity="0.3"
          />
          <rect x="19" y="9" width="10" height="23" rx="2" />
          <rect x="19" y="43" width="10" height="15" rx="2" opacity="0.6" />
          <rect x="130" y="9" width="10" height="24" rx="2" />
          <rect x="130" y="38" width="10" height="20" rx="2" opacity="0.6" />
        </>
      );
    case "score":
      return (
        <>
          {[
            { x: 37, arc: 83 },
            { x: 80, arc: 56 },
            { x: 123, arc: 36 },
          ].map(({ x, arc }) => (
            <g key={x}>
              <circle
                cx={x}
                cy="32"
                r="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                opacity="0.13"
              />
              <circle
                cx={x}
                cy="32"
                r="17"
                fill="none"
                stroke="currentColor"
                strokeWidth="6"
                strokeDasharray={`${arc} 107`}
                transform={`rotate(-90 ${x} 32)`}
                strokeLinecap="round"
              />
              <rect x={x - 6} y="30" width="12" height="4" rx="2" opacity="0.6" />
              <rect x={x - 10} y="59" width="20" height="4" rx="2" opacity="0.25" />
            </g>
          ))}
        </>
      );
    case "gauge":
      return (
        <>
          <path
            d="M44 56A36 36 0 0 1 116 56"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
            opacity="0.15"
          />
          <path
            d="M44 56A36 36 0 0 1 103 28"
            fill="none"
            stroke="currentColor"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <path
            d="M80 56 98 37"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="80" cy="56" r="5" />
        </>
      );
    case "treemap":
      return (
        <>
          <rect x="14" y="9" width="69" height="54" rx="3" />
          <rect x="86" y="9" width="60" height="24" rx="3" opacity="0.65" />
          <rect x="86" y="36" width="34" height="27" rx="3" opacity="0.45" />
          <rect x="123" y="36" width="23" height="27" rx="3" opacity="0.25" />
        </>
      );
    case "heatmap":
      return (
        <>
          {[
            { y: 10, levels: [0.2, 0.5, 0.35, 0.75, 0.95] },
            { y: 28, levels: [0.4, 0.75, 1, 0.35, 0.6] },
            { y: 46, levels: [0.65, 0.25, 0.5, 0.9, 0.4] },
          ].map(({ y, levels }) => (
            <g key={y}>
              {levels.map((level, i) => (
                <rect
                  key={`${y}-${level}`}
                  x={20 + i * 25}
                  y={y}
                  width="21"
                  height="15"
                  rx="2"
                  opacity={level}
                />
              ))}
            </g>
          ))}
        </>
      );
    case "pivot":
      return (
        <>
          <rect x="14" y="8" width="132" height="12" rx="3" opacity="0.2" />
          <rect x="14" y="8" width="30" height="56" rx="3" opacity="0.2" />
          {[26, 39, 52].map((y, row) =>
            [52, 76, 100, 124].map((x, col) => (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width="18"
                height="9"
                rx="2"
                opacity={0.2 + ((row * 4 + col * 3) % 7) * 0.1}
              />
            )),
          )}
          <path d="M14 64H146M146 8V64" stroke="currentColor" strokeWidth="2" opacity="0.35" />
        </>
      );
    case "table":
      return (
        <>
          <rect x="14" y="10" width="132" height="14" rx="3" opacity="0.2" />
          <path d="M14 39H146M14 54H146M59 10V63M107 10V63" stroke="currentColor" opacity="0.15" />
          {[17, 32, 47, 62].map((y) => (
            <g key={y}>
              <rect x="21" y={y - 2} width="26" height="4" rx="2" opacity="0.45" />
              <rect x="68" y={y - 2} width="27" height="4" rx="2" opacity="0.7" />
              <rect x="116" y={y - 2} width="21" height="4" rx="2" opacity="0.45" />
            </g>
          ))}
        </>
      );
  }
}

export function ChartKindPreview({ kind, className }: { kind: ChartKind; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 160 72"
      className={cn("h-16 w-full fill-current text-primary", className)}
    >
      {illustration(kind)}
    </svg>
  );
}

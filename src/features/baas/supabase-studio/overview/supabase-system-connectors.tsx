import { cn } from "@/lib/utils";

const ROWS = 5;

export function SupabaseSystemConnectors({
  fromLeft,
  states,
}: {
  fromLeft: boolean;
  states: (boolean | undefined)[];
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 48 ${ROWS * 20}`}
      preserveAspectRatio="none"
      className="h-full w-full overflow-visible"
    >
      {states.map((healthy, index) => {
        const y = index * 20 + 10;
        const center = ROWS * 10;
        const [from, to] = fromLeft ? [center, y] : [y, center];
        return (
          <path
            key={y}
            d={`M0,${from} C24,${from} 24,${to} 48,${to}`}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1.25}
            strokeDasharray={healthy === false ? "4 3" : undefined}
            className={cn(
              healthy === false
                ? "stroke-amber-500"
                : healthy
                  ? "stroke-primary/45"
                  : "stroke-border",
            )}
          />
        );
      })}
    </svg>
  );
}

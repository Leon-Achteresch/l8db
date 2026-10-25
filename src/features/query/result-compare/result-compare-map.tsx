import { useMemo } from "react";
import type { ResultChange, ResultChangeKind } from "@/lib/result-compare";
import { cn } from "@/lib/utils";
import { CHANGE_TONE } from "./tone";

const WIDTH = 1000;
const MARK = 7;
const TRACK: Record<ResultChangeKind, [number, number]> = {
  added: [0, 6],
  removed: [8, 6],
  changed: [0, 14],
};

export function ResultCompareMap({
  changes,
  selectedId,
  onSelect,
}: {
  changes: ResultChange[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const paths = useMemo(() => {
    const out: Record<ResultChangeKind, string> = { added: "", removed: "", changed: "" };
    for (const change of changes) {
      const [y, height] = TRACK[change.kind];
      const x = (change.position * (WIDTH - MARK)).toFixed(1);
      out[change.kind] += `M${x} ${y}h${MARK}v${height}h-${MARK}z`;
    }
    return out;
  }, [changes]);
  const selected = changes.find((change) => change.id === selectedId);

  const pick = (clientX: number, target: Element) => {
    if (changes.length === 0) return;
    const rect = target.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    let best = changes[0];
    for (const change of changes)
      if (Math.abs(change.position - ratio) < Math.abs(best.position - ratio)) best = change;
    onSelect(best.id);
  };

  return (
    <div className="flex items-center gap-2 px-3 pb-2 pt-1.5">
      <span className="w-9 shrink-0 text-[10px] leading-none text-muted-foreground">
        Jetzt
        <br />
        Basis
      </span>
      <svg
        viewBox={`0 0 ${WIDTH} 14`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-3.5 min-w-0 flex-1 cursor-pointer overflow-visible rounded-sm bg-muted"
        onPointerDown={(event) => pick(event.clientX, event.currentTarget)}
      >
        <line x1="0" x2={WIDTH} y1="7" y2="7" className="stroke-border" strokeWidth="1" />
        {(Object.keys(paths) as ResultChangeKind[]).map((kind) => (
          <path key={kind} d={paths[kind]} className={cn(CHANGE_TONE[kind].fill, "opacity-80")} />
        ))}
        {selected && (
          <rect
            x={selected.position * (WIDTH - MARK) - 2}
            y={-2}
            width={MARK + 4}
            height={18}
            rx={1}
            className="fill-none stroke-foreground"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

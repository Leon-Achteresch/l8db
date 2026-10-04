export function IslandRing({ percent }: { percent: number }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90 text-sky-400">
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2.5}
      />
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={1 - Math.min(1, Math.max(0.02, percent / 100))}
      />
    </svg>
  );
}

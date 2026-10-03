import { useEffect, useState } from "react";
import type { PartProps } from "./shared";

export function Percent({ size, speed, reduce }: PartProps) {
  const [p, setP] = useState(0);
  useEffect(() => {
    const dur = (reduce ? speed * 2 : speed) * 1000;
    const start = { t: 0 };
    const tickMs = 40;
    const id = setInterval(() => {
      start.t += tickMs;
      const next = Math.min(100, Math.round((start.t / dur) * 100));
      setP(next);
      if (next >= 100) start.t = 0;
    }, tickMs);
    return () => clearInterval(id);
  }, [speed, reduce]);
  return (
    <span className="flex flex-col items-center" style={{ gap: size * 0.14, width: size * 1.4 }}>
      <span
        className="font-mono font-medium tabular-nums"
        style={{ fontSize: size * 0.42, lineHeight: 1 }}
      >
        {p}%
      </span>
      <span
        className="w-full overflow-hidden rounded-full bg-current/15"
        style={{ height: Math.max(3, size * 0.1) }}
      >
        <span className="block h-full rounded-full bg-current" style={{ width: `${p}%` }} />
      </span>
    </span>
  );
}

import { useEffect, useState } from "react";
import type { PartProps } from "./shared";

export function Ascii({
  frames,
  size,
  speed,
  reduce,
}: PartProps & {
  frames: string[];
}) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const step = ((reduce ? speed * 2.5 : speed) / frames.length) * 1000;
    const id = setInterval(() => setFrame((f) => (f + 1) % frames.length), step);
    return () => clearInterval(id);
  }, [frames.length, speed, reduce]);
  return (
    <span className="font-mono leading-none tabular-nums" style={{ fontSize: size, lineHeight: 1 }}>
      {frames[frame % frames.length]}
    </span>
  );
}

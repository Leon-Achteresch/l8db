import { useEffect, useState } from "react";
import { type PartProps, SCRAMBLE_GLYPHS, SCRAMBLE_TARGET } from "./shared";

export function Scramble({ size, speed, reduce }: PartProps) {
  const [text, setText] = useState(SCRAMBLE_TARGET);
  useEffect(() => {
    if (reduce) {
      setText(SCRAMBLE_TARGET);
      return;
    }
    let tick = 0;
    const total = SCRAMBLE_TARGET.length + 4;
    const id = setInterval(
      () => {
        const reveal = tick % total;
        let s = "";
        for (let i = 0; i < SCRAMBLE_TARGET.length; i++) {
          s +=
            i < reveal
              ? SCRAMBLE_TARGET[i]
              : SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
        }
        setText(s);
        tick++;
      },
      (speed / SCRAMBLE_TARGET.length) * 1000 * 0.55,
    );
    return () => clearInterval(id);
  }, [speed, reduce]);
  return (
    <span
      className="font-mono font-medium tracking-[0.2em] tabular-nums"
      style={{ fontSize: size * 0.42 }}
    >
      {text}
    </span>
  );
}

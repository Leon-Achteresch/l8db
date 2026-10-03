import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import { NEWTON_BALLS, type PartProps } from "./shared";

export function Newton({ size, speed, reduce }: PartProps) {
  const d = size * 0.2;
  const out = d * 1.1;
  const moves: Record<
    number,
    {
      x: number[];
      times: number[];
    }
  > = {
    0: { x: [0, -out, 0, 0], times: [0, 0.28, 0.5, 1] },
    4: { x: [0, 0, out, 0], times: [0, 0.5, 0.78, 1] },
  };
  return (
    <span className="flex items-center justify-center" style={{ height: d }}>
      {NEWTON_BALLS.map((i) => {
        const move = moves[i];
        return (
          <motion.span
            key={i}
            className="rounded-full bg-current"
            style={{ width: d, height: d }}
            animate={reduce || !move ? undefined : { x: move.x }}
            transition={
              reduce || !move
                ? undefined
                : {
                    duration: speed * 1.5,
                    ease: EASE_IN_OUT,
                    repeat: Infinity,
                    times: move.times,
                  }
            }
          />
        );
      })}
    </span>
  );
}

import { motion } from "motion/react";
import { COMET_TRAIL, type PartProps, REDUCED } from "./shared";

export function Comet({ size, speed, reduce }: PartProps) {
  const head = size * 0.2;
  const r = size / 2 - head / 2;
  return (
    <span className="relative" style={{ width: size, height: size }}>
      <motion.span
        className="absolute inset-0"
        animate={reduce ? REDUCED.animate : { rotate: 360 }}
        transition={
          reduce ? REDUCED.transition : { duration: speed, ease: "linear", repeat: Infinity }
        }
      >
        {COMET_TRAIL.map((i) => {
          const scale = 1 - i * 0.13;
          const sz = head * scale;
          return (
            <span
              key={i}
              className="absolute top-1/2 left-1/2 rounded-full bg-current"
              style={{
                width: sz,
                height: sz,
                marginLeft: -sz / 2,
                marginTop: -sz / 2,
                opacity: 1 - i * 0.16,
                transform: `rotate(${-i * 15}deg) translateY(${-r}px)`,
              }}
            />
          );
        })}
      </motion.span>
    </span>
  );
}

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect } from "react";
import { EASE_OUT } from "@/lib/ease";

export function TransferCinemaCounter({ value }: { value: number }) {
  const current = useMotionValue(0);
  const text = useTransform(current, (entry) => Math.round(entry).toLocaleString("de-DE"));
  useEffect(() => {
    const controls = animate(current, value, { duration: 0.7, ease: EASE_OUT });
    return () => controls.stop();
  }, [current, value]);
  return (
    <motion.span className="font-mono text-6xl font-light tracking-tight text-white tabular-nums">
      {text}
    </motion.span>
  );
}

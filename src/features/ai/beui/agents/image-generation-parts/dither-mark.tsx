import { Check, CircleAlert } from "lucide-react";
import { motion } from "motion/react";
import { EASE_IN_OUT } from "@/features/ai/beui/lib/ease";
import type { ImageGenerationStatus } from "./shared";

export function DitherMark({ status, reduce }: { status: ImageGenerationStatus; reduce: boolean }) {
  if (status === "complete") {
    return <Check aria-hidden="true" className="size-3.5" />;
  }
  if (status === "error") {
    return <CircleAlert aria-hidden="true" className="size-3.5" />;
  }
  return (
    <motion.span
      aria-hidden="true"
      animate={reduce ? undefined : { rotate: 360 }}
      transition={{
        duration: 2.4,
        ease: EASE_IN_OUT,
        repeat: Number.POSITIVE_INFINITY,
      }}
      className="grid size-3.5 grid-cols-2 place-items-center gap-0.5"
    >
      <span className="size-1 rounded-[1px] bg-current" />
      <span className="size-1 rounded-[1px] bg-current opacity-55" />
      <span className="size-1 rounded-[1px] bg-current opacity-55" />
      <span className="size-1 rounded-[1px] bg-current" />
    </motion.span>
  );
}

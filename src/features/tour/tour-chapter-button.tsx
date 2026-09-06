import { Check } from "lucide-react";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props {
  index: number;
  title: string;
  summary: string;
  active: boolean;
  done: boolean;
  onSelect: () => void;
}

export function TourChapterButton({ index, title, summary, active, done, onSelect }: Props) {
  return (
    <motion.button
      type="button"
      layout
      transition={{ layout: SPRING_LAYOUT }}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
        active ? "bg-primary/12 text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
          done && "bg-primary text-primary-foreground",
          active && !done && "bg-primary/20 text-foreground",
          !active && !done && "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="size-3" /> : index + 1}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{summary}</span>
      </span>
    </motion.button>
  );
}

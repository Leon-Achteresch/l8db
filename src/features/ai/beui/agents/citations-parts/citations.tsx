import { BookOpenText, ChevronDown } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useState } from "react";
import { AgentDisclosure } from "@/features/ai/beui/agents/agent-disclosure";
import { SPRING_SWAP } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
import { CitationList } from "./citation-list";
import type { CitationsProps } from "./shared";

export function Citations({
  citations,
  title = "Quellen",
  open,
  defaultOpen = false,
  onOpenChange,
  idPrefix,
  className,
}: CitationsProps) {
  const reduce = useReducedMotion() ?? false;
  const baseId = useId();
  const contentId = `${baseId}-content`;
  const resolvedPrefix = idPrefix ?? `citation-${baseId.replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const currentOpen = open ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (open === undefined) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange, open],
  );
  return (
    <div className={cn("w-full text-sm", className)}>
      <button
        type="button"
        aria-expanded={currentOpen}
        aria-controls={contentId}
        onClick={() => setOpen(!currentOpen)}
        className="group -ml-1 flex min-h-8 items-center gap-2 rounded-lg px-1 text-left text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BookOpenText className="size-4" />
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
          {citations.length}
        </span>
        <motion.span
          aria-hidden="true"
          animate={{ rotate: currentOpen ? 180 : 0 }}
          transition={reduce ? { duration: 0 } : SPRING_SWAP}
          className="text-muted-foreground/60"
        >
          <ChevronDown className="size-3.5" />
        </motion.span>
      </button>

      <AgentDisclosure id={contentId} open={currentOpen}>
        <CitationList citations={citations} idPrefix={resolvedPrefix} className="mt-1" />
      </AgentDisclosure>
    </div>
  );
}

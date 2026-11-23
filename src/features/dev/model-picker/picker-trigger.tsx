import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { type LabSelection, labLookup } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";

export function PickerTrigger({
  selection,
  open,
  onClick,
}: {
  selection: LabSelection;
  open: boolean;
  onClick: () => void;
}) {
  const { provider, model } = labLookup(selection);
  return (
    <motion.button
      type="button"
      layout
      aria-expanded={open}
      aria-label={`Modell: ${provider.name} · ${model.name}`}
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "flex h-8 items-center gap-1.5 overflow-hidden rounded-full pr-2 pl-1.5 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        open && "bg-muted",
      )}
    >
      <motion.span layout="position" className="grid size-5 place-items-center">
        <ProviderMark id={provider.id} className="size-3.5" />
      </motion.span>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={model.id}
          layout="position"
          initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(3px)" }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
          className="whitespace-nowrap font-medium"
        >
          {model.name}
        </motion.span>
      </AnimatePresence>
      <motion.span layout="position" animate={{ rotate: open ? 180 : 0 }}>
        <ChevronDown className="size-3 text-muted-foreground" />
      </motion.span>
    </motion.button>
  );
}

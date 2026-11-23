import { Check } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { EffortSegments } from "./effort-segments";
import { LAB_PROVIDERS, type LabSelection } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";

export function QuickSheet({
  value,
  onPick,
  onEffort,
  onClose,
}: {
  value: LabSelection;
  onPick: (provider: string, model: string) => void;
  onEffort: (effort: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 z-20 bg-background/40 backdrop-blur-[2px]"
      />
      <motion.div
        role="dialog"
        aria-label="Alle Modelle"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 380, damping: 38 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.6 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 80 || info.velocity.y > 500) onClose();
        }}
        className="absolute inset-x-2 bottom-0 z-30 max-h-[88%] overflow-hidden rounded-t-3xl border bg-popover text-popover-foreground shadow-2xl shadow-black/30"
      >
        <div className="grid cursor-grab place-items-center pt-2 pb-1 active:cursor-grabbing">
          <span className="h-1 w-9 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="max-h-[330px] overflow-y-auto px-3 pb-2">
          {LAB_PROVIDERS.map((provider, groupIndex) => (
            <motion.div
              key={provider.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.06 + groupIndex * 0.04,
                type: "spring",
                stiffness: 400,
                damping: 32,
              }}
              className="py-1.5"
            >
              <div className="flex items-center gap-1.5 px-1 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                <ProviderMark id={provider.id} className="size-3" />
                {provider.short}
              </div>
              <div className="flex flex-wrap gap-1">
                {provider.models.map((model) => {
                  const selected = value.provider === provider.id && value.model === model.id;
                  return (
                    <motion.button
                      key={model.id}
                      type="button"
                      aria-pressed={selected}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => onPick(provider.id, model.id)}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-full bg-muted/60 px-3 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                        selected && "bg-foreground text-background hover:bg-foreground",
                      )}
                    >
                      {selected && <Check className="size-3" />}
                      {model.name}
                      {model.badge && (
                        <span
                          className={cn(
                            "text-[10px] text-muted-foreground",
                            selected && "text-background/70",
                          )}
                        >
                          {model.badge}
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          ))}
        </div>
        <div className="flex items-center gap-3 bg-muted/40 px-4 py-3">
          <span className="text-[11px] text-muted-foreground">Denken</span>
          <div className="flex-1">
            <EffortSegments id="quick" value={value.effort} onChange={onEffort} />
          </div>
        </div>
      </motion.div>
    </>
  );
}

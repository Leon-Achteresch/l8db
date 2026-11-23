import { Check } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { EffortSlider } from "./effort-slider";
import { ModelMeter } from "./model-meter";
import { LAB_PROVIDERS, type LabSelection } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";

export function RailBody({
  value,
  onChange,
  onDone,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
  onDone: () => void;
}) {
  const [browse, setBrowse] = useState(value.provider);
  const [direction, setDirection] = useState(1);
  const index = LAB_PROVIDERS.findIndex((provider) => provider.id === browse);
  const provider = LAB_PROVIDERS[Math.max(0, index)];
  return (
    <div className="flex">
      <div
        role="tablist"
        aria-orientation="vertical"
        aria-label="Anbieter"
        className="flex flex-col gap-1 bg-muted/40 p-1.5"
      >
        {LAB_PROVIDERS.map((entry, entryIndex) => {
          const active = entry.id === browse;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={entry.name}
              title={entry.name}
              onClick={() => {
                setDirection(entryIndex > index ? 1 : -1);
                setBrowse(entry.id);
              }}
              className={cn(
                "relative grid size-9 place-items-center rounded-xl text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                active && "text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="rail-active"
                  transition={{ type: "spring", stiffness: 550, damping: 38 }}
                  className="absolute inset-0 rounded-xl bg-background shadow-sm"
                />
              )}
              <motion.span
                className="relative"
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.9 }}
              >
                <ProviderMark id={entry.id} className="size-4" />
              </motion.span>
              {value.provider === entry.id && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-emerald-500" />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative h-[268px] overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div
              key={provider.id}
              custom={direction}
              variants={{
                enter: (dir: number) => ({ y: dir * 24, opacity: 0, filter: "blur(4px)" }),
                center: { y: 0, opacity: 1, filter: "blur(0px)" },
                exit: (dir: number) => ({ y: dir * -24, opacity: 0, filter: "blur(4px)" }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
              className="space-y-0.5 p-2"
            >
              <div className="flex items-baseline justify-between px-2 pt-1 pb-2">
                <span className="text-[13px] font-semibold tracking-tight">{provider.name}</span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {provider.cli ? "CLI" : "API"}
                </span>
              </div>
              {provider.models.map((model, modelIndex) => {
                const selected = value.provider === provider.id && value.model === model.id;
                return (
                  <motion.button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.04 + modelIndex * 0.035 }}
                    onClick={() => {
                      onChange({ ...value, provider: provider.id, model: model.id });
                      onDone();
                    }}
                    className={cn(
                      "flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                      selected && "bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium">
                        {model.name}
                        {selected && <Check className="size-3" />}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {model.hint} · {model.context}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1 text-[9px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        Tempo <ModelMeter value={model.speed} label="Tempo" />
                      </span>
                      <span className="flex items-center gap-1.5">
                        Tiefe <ModelMeter value={model.smarts} label="Tiefe" />
                      </span>
                    </span>
                  </motion.button>
                );
              })}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="px-4 pt-1 pb-3">
          <EffortSlider
            value={value.effort}
            onChange={(effort) => onChange({ ...value, effort })}
          />
        </div>
      </div>
    </div>
  );
}

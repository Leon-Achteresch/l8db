import { motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { ModelMeter } from "./model-meter";
import { LAB_EFFORTS, LAB_PROVIDERS, type LabSelection } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";

export function IslandBody({
  value,
  onChange,
  onDone,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
  onDone: () => void;
}) {
  const [browse, setBrowse] = useState(value.provider);
  const provider = LAB_PROVIDERS.find((entry) => entry.id === browse) ?? LAB_PROVIDERS[0];
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { delay: 0.08 } }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      className="space-y-3 p-3"
    >
      <div role="tablist" aria-label="Anbieter" className="flex flex-wrap gap-1">
        {LAB_PROVIDERS.map((entry) => {
          const active = entry.id === browse;
          return (
            <motion.button
              key={entry.id}
              layout
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={entry.name}
              onClick={() => setBrowse(entry.id)}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              style={{ borderRadius: 999 }}
              className={cn(
                "flex h-8 items-center gap-1.5 overflow-hidden px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <motion.span layout="position">
                <ProviderMark id={entry.id} className="size-3.5" />
              </motion.span>
              {active && (
                <motion.span
                  layout="position"
                  initial={{ opacity: 0, filter: "blur(4px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)" }}
                  className="whitespace-nowrap font-medium"
                >
                  {entry.short}
                </motion.span>
              )}
            </motion.button>
          );
        })}
      </div>
      <motion.div key={provider.id} className="grid grid-cols-2 gap-1.5">
        {provider.models.map((model, index) => {
          const selected = value.provider === provider.id && value.model === model.id;
          return (
            <motion.button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={selected}
              initial={{ opacity: 0, y: 10, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 460, damping: 30, delay: index * 0.04 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                onChange({ ...value, provider: provider.id, model: model.id });
                onDone();
              }}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl bg-muted/50 p-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                selected && "bg-foreground/[0.07] ring-1 ring-foreground/20",
              )}
            >
              <span className="flex w-full items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  {model.name}
                </span>
                {selected && <span className="size-1.5 rounded-full bg-emerald-500" />}
              </span>
              <span className="text-[11px] leading-4 text-muted-foreground">{model.hint}</span>
              <span className="flex w-full items-center justify-between">
                <span className="flex items-center gap-2">
                  <ModelMeter value={model.speed} label="Tempo" />
                  <ModelMeter value={model.smarts} label="Tiefe" />
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">{model.context}</span>
              </span>
            </motion.button>
          );
        })}
      </motion.div>
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-muted-foreground">Denken</span>
        <div role="radiogroup" aria-label="Denkaufwand" className="flex items-center gap-1">
          {LAB_EFFORTS.map((effort, index) => {
            const current = LAB_EFFORTS.findIndex((entry) => entry.id === value.effort);
            return (
              <button
                key={effort.id}
                type="button"
                role="radio"
                aria-checked={effort.id === value.effort}
                aria-label={effort.name}
                title={effort.name}
                onClick={() => onChange({ ...value, effort: effort.id })}
                className="grid h-6 w-5 place-items-end pb-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <motion.span
                  animate={{
                    height: 6 + index * 4,
                    opacity: index <= current ? 1 : 0.25,
                  }}
                  transition={{ type: "spring", stiffness: 500, damping: 26 }}
                  className="w-1.5 rounded-full bg-foreground"
                />
              </button>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

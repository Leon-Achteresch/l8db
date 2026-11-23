import { LayoutGrid } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { LAB_PROVIDERS, type LabSelection } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";
import { QuickSheet } from "./quick-sheet";

const START = [
  { provider: "claude", model: "sonnet-5-5" },
  { provider: "codex", model: "gpt-6.2-sol" },
  { provider: "claude", model: "haiku-5-5" },
];

export function QuickChips({
  value,
  onChange,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
}) {
  const [recent, setRecent] = useState(START);
  const [sheet, setSheet] = useState(false);
  const pick = (provider: string, model: string) => {
    onChange({ ...value, provider, model });
    setRecent((list) =>
      list.some((entry) => entry.provider === provider && entry.model === model)
        ? list
        : [{ provider, model }, ...list].slice(0, 3),
    );
  };
  return (
    <>
      <div
        role="radiogroup"
        aria-label="Zuletzt genutzte Modelle"
        className="flex items-center gap-1"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {recent.map((entry) => {
            const provider = LAB_PROVIDERS.find((item) => item.id === entry.provider);
            const model = provider?.models.find((item) => item.id === entry.model);
            if (!provider || !model) return null;
            const active = value.provider === entry.provider && value.model === entry.model;
            return (
              <motion.button
                key={`${entry.provider}/${entry.model}`}
                layout
                type="button"
                role="radio"
                aria-checked={active}
                initial={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, scale: 0.8, filter: "blur(4px)" }}
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => pick(entry.provider, entry.model)}
                className={cn(
                  "relative flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                  active && "text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="quick-active"
                    transition={{ type: "spring", stiffness: 550, damping: 38 }}
                    className="absolute inset-0 rounded-full bg-background shadow-sm"
                  />
                )}
                <ProviderMark id={provider.id} className="relative size-3" />
                <span className="relative whitespace-nowrap font-medium">{model.name}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        <motion.button
          layout
          type="button"
          aria-label="Alle Modelle"
          title="Alle Modelle"
          whileTap={{ scale: 0.9 }}
          onClick={() => setSheet(true)}
          className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LayoutGrid className="size-3.5" />
        </motion.button>
      </div>
      <AnimatePresence>
        {sheet && (
          <QuickSheet
            value={value}
            onPick={(provider, model) => {
              pick(provider, model);
              setSheet(false);
            }}
            onEffort={(effort) => onChange({ ...value, effort })}
            onClose={() => setSheet(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}

import { Check, Search } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { EffortSegments } from "./effort-segments";
import { LAB_PROVIDERS, type LabSelection } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";

const FILTERS = [
  { id: "all", name: "Alle" },
  { id: "cli", name: "Lokale CLIs" },
  { id: "api", name: "API" },
];

export function PaletteBody({
  value,
  onChange,
  onDone,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [active, setActive] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return LAB_PROVIDERS.filter(
      (provider) => filter === "all" || provider.cli === (filter === "cli"),
    )
      .map((provider) => ({
        provider,
        models: provider.models.filter(
          (model) =>
            !needle ||
            `${model.name} ${provider.name} ${model.hint}`.toLowerCase().includes(needle),
        ),
      }))
      .filter((group) => group.models.length);
  }, [query, filter]);
  const flat = groups.flatMap((group) =>
    group.models.map((model) => ({ provider: group.provider.id, model: model.id })),
  );
  const pick = (provider: string, model: string) => {
    onChange({ ...value, provider, model });
    onDone();
  };
  const move = (step: number) => {
    const index = flat.findIndex((entry) => `${entry.provider}/${entry.model}` === active);
    const next = flat[(index + step + flat.length) % flat.length];
    if (next) setActive(`${next.provider}/${next.model}`);
  };
  return (
    <div>
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          ref={input}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              move(event.key === "ArrowDown" ? 1 : -1);
            }
            if (event.key === "Enter" && active) {
              const [provider, model] = active.split("/");
              pick(provider, model);
            }
          }}
          aria-label="Modelle durchsuchen"
          placeholder="Modell suchen …"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(null);
          }}
          className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="flex gap-1 px-2 pb-2">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
            className={cn(
              "relative h-6 rounded-full px-2.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              filter === entry.id && "text-foreground",
            )}
          >
            {filter === entry.id && (
              <motion.span
                layoutId="palette-filter"
                transition={{ type: "spring", stiffness: 600, damping: 40 }}
                className="absolute inset-0 rounded-full bg-muted"
              />
            )}
            <span className="relative">{entry.name}</span>
          </button>
        ))}
      </div>
      <motion.div
        layout
        role="listbox"
        aria-label="Modelle"
        onPointerLeave={() => setActive(null)}
        className="max-h-[300px] overflow-y-auto px-1.5 pb-1.5"
      >
        {groups.length === 0 && (
          <div className="py-8 text-center text-xs text-muted-foreground">Kein Treffer</div>
        )}
        {groups.map(({ provider, models }, groupIndex) => (
          <motion.div
            key={provider.id}
            layout="position"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIndex * 0.03 }}
            className="pb-1"
          >
            <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              <ProviderMark id={provider.id} className="size-3" />
              {provider.short}
            </div>
            {models.map((model) => {
              const key = `${provider.id}/${model.id}`;
              const selected = value.provider === provider.id && value.model === model.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onPointerEnter={() => setActive(key)}
                  onClick={() => pick(provider.id, model.id)}
                  className="relative flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] outline-none"
                >
                  {active === key && (
                    <motion.span
                      layoutId="palette-hover"
                      transition={{ type: "spring", stiffness: 700, damping: 45 }}
                      className="absolute inset-0 rounded-lg bg-muted"
                    />
                  )}
                  <span className={cn("relative min-w-0 truncate", selected && "font-medium")}>
                    {model.name}
                  </span>
                  {model.badge && (
                    <span className="relative rounded-full bg-primary/10 px-1.5 py-px text-[10px] text-primary">
                      {model.badge}
                    </span>
                  )}
                  <span className="relative flex-1" />
                  <span className="relative font-mono text-[10px] text-muted-foreground tabular-nums">
                    {model.context}
                  </span>
                  <span className="relative grid size-3.5 place-items-center">
                    {selected && (
                      <motion.span
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ type: "spring", stiffness: 600, damping: 20 }}
                      >
                        <Check className="size-3.5" />
                      </motion.span>
                    )}
                  </span>
                </button>
              );
            })}
          </motion.div>
        ))}
      </motion.div>
      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
        <span className="text-[11px] text-muted-foreground">Denken</span>
        <div className="flex-1">
          <EffortSegments
            id="palette"
            value={value.effort}
            onChange={(effort) => onChange({ ...value, effort })}
          />
        </div>
      </div>
    </div>
  );
}

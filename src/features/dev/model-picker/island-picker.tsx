import { ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { IslandBody } from "./island-body";
import { type LabSelection, labLookup } from "./model-picker-data";
import { ProviderMark } from "./provider-mark";

const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

export function IslandPicker({
  value,
  onChange,
}: {
  value: LabSelection;
  onChange: (value: LabSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const { provider, model } = labLookup(value);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pill = (
    <>
      <motion.span layout="position" className="grid size-5 place-items-center">
        <ProviderMark id={provider.id} className="size-3.5" />
      </motion.span>
      <motion.span layout="position" className="whitespace-nowrap font-medium">
        {model.name}
      </motion.span>
      <motion.span layout="position">
        <ChevronUp className="size-3 text-muted-foreground" />
      </motion.span>
    </>
  );
  return (
    <div ref={root} className="relative">
      {open ? (
        <div className="flex h-8 items-center gap-1.5 pr-2 pl-1.5 text-xs opacity-0" aria-hidden>
          {pill}
        </div>
      ) : (
        <motion.button
          layoutId="island-picker"
          type="button"
          aria-expanded={false}
          aria-label={`Modell: ${provider.name} · ${model.name}`}
          onClick={() => setOpen(true)}
          transition={SPRING}
          style={{ borderRadius: 999 }}
          className="flex h-8 items-center gap-1.5 bg-muted pr-2 pl-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pill}
        </motion.button>
      )}
      <AnimatePresence>
        {open && (
          <motion.div
            layoutId="island-picker"
            role="dialog"
            aria-label="Modell auswählen"
            transition={SPRING}
            style={{ borderRadius: 22 }}
            className="absolute right-0 bottom-0 z-20 w-[360px] overflow-hidden border bg-popover text-popover-foreground shadow-2xl shadow-black/25"
          >
            <IslandBody value={value} onChange={onChange} onDone={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

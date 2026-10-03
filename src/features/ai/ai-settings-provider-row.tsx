import { ChevronDown, Loader2, Server } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { ThesvgIcon } from "@/components/provider-logo";
import { cn } from "@/lib/utils";
import { aiProviderSvg } from "./ai-provider-icons";

const EASE = [0.22, 1, 0.36, 1] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;

interface Props {
  id: string;
  name: string;
  status: string;
  tone: "ready" | "idle" | "checking";
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}
export function AiSettingsProviderRow({
  id,
  name,
  status,
  tone,
  active,
  open,
  onToggle,
  children,
}: Props) {
  const svg = aiProviderSvg(id);
  return (
    <div
      className={cn(
        "rounded-2xl border transition-[background-color,border-color,box-shadow] duration-200 ease-smooth-out",
        open
          ? "border-border bg-background shadow-[0_1px_2px_rgb(0_0_0/0.04),0_8px_24px_-12px_rgb(0_0_0/0.18)]"
          : "border-transparent hover:bg-muted/50",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`${name} konfigurieren`}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-2xl p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-lg transition-colors duration-200",
            open ? "bg-muted" : "bg-muted/60",
          )}
        >
          {svg ? <ThesvgIcon svg={svg} className="size-4" /> : <Server className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-medium">{name}</span>
            {active && (
              <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary">
                Aktiv
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <span className="relative grid size-3 shrink-0 place-items-center">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={tone}
                  className="grid place-items-center"
                  initial={{ opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" }}
                  animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
                  exit={{ opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" }}
                  transition={ICON_SWAP}
                >
                  {tone === "checking" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        tone === "ready"
                          ? "bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.15)]"
                          : "bg-muted-foreground/40",
                      )}
                    />
                  )}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="truncate">{status}</span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-smooth-out",
            open && "rotate-180",
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { duration: 0.26, ease: EASE } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.18, ease: EASE } }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-2 pt-1 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

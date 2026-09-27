import {
  ActivityIcon,
  BadgeCheckIcon,
  CheckIcon,
  DownloadIcon,
  KeyRoundIcon,
  type LucideIcon,
  PuzzleIcon,
  Settings2Icon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EASE_OUT, SPRING_SWAP } from "@/lib/ease";
import type { MarketExtension } from "@/lib/extensions/market";
import { cn } from "@/lib/utils";

const LOOKS: { icon: LucideIcon; from: string; to: string; glow: string }[] = [
  { icon: PuzzleIcon, from: "bg-indigo-500", to: "bg-fuchsia-500", glow: "shadow-indigo-500/40" },
  { icon: PuzzleIcon, from: "bg-sky-500", to: "bg-emerald-400", glow: "shadow-sky-500/40" },
  { icon: PuzzleIcon, from: "bg-amber-500", to: "bg-rose-500", glow: "shadow-amber-500/40" },
];

const KNOWN: Record<string, (typeof LOOKS)[number]> = {
  "l8db.password-manager": {
    icon: KeyRoundIcon,
    from: "bg-emerald-500",
    to: "bg-cyan-500",
    glow: "shadow-emerald-500/40",
  },
  "l8db.jev": {
    icon: ActivityIcon,
    from: "bg-violet-500",
    to: "bg-orange-400",
    glow: "shadow-violet-500/40",
  },
};

interface OnboardingExtensionCardProps {
  entry: MarketExtension;
  index: number;
  installed: boolean;
  pending: boolean;
  onInstall: () => void;
  onSetup: () => void;
}

export function OnboardingExtensionCard({
  entry,
  index,
  installed,
  pending,
  onInstall,
  onSetup,
}: OnboardingExtensionCardProps) {
  const look = KNOWN[entry.id] ?? LOOKS[index % LOOKS.length];
  const Icon = look.icon;

  return (
    <motion.article
      aria-label={entry.name}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
      initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
      animate={{
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
        transition: { duration: 0.6, delay: 0.1 + index * 0.08, ease: EASE_OUT },
      }}
      whileHover={{ y: -4, transition: { duration: 0.25, ease: EASE_OUT } }}
    >
      <div className="relative flex h-36 items-center justify-center overflow-hidden bg-muted/40">
        <motion.span
          aria-hidden
          className={cn(
            "absolute -left-8 -top-10 size-40 rounded-full opacity-60 blur-3xl",
            look.from,
          )}
          animate={{ x: [0, 40, 0], y: [0, 20, 0] }}
          transition={{ duration: 9, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <motion.span
          aria-hidden
          className={cn(
            "absolute -right-10 -bottom-12 size-44 rounded-full opacity-50 blur-3xl",
            look.to,
          )}
          animate={{ x: [0, -36, 0], y: [0, -18, 0] }}
          transition={{ duration: 11, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:22px_22px] opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
        />
        <motion.span
          aria-hidden
          className={cn(
            "relative flex size-16 items-center justify-center rounded-2xl border border-white/30 text-white shadow-2xl transition-transform duration-300 group-hover:scale-110",
            look.from,
            look.glow,
          )}
          animate={{ y: [0, -5, 0] }}
          transition={{
            duration: 4,
            delay: index * 0.4,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        >
          <Icon className="size-7 drop-shadow" />
        </motion.span>
        <AnimatePresence>
          {installed && (
            <motion.span
              className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-background/80 px-2 py-0.5 text-[11px] font-medium backdrop-blur"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={SPRING_SWAP}
            >
              <CheckIcon className="size-3 text-primary" />
              Installiert
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold">{entry.name}</h3>
            <BadgeCheckIcon aria-label="Offiziell" className="size-4 shrink-0 text-primary" />
            <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
              v{entry.version}
            </span>
          </div>
          <p className="mt-1 text-xs leading-snug text-pretty text-muted-foreground">
            {entry.description}
          </p>
        </div>
        <Button
          className="mt-auto w-full"
          size="sm"
          variant={installed ? "secondary" : "default"}
          disabled={pending}
          onClick={installed ? onSetup : onInstall}
        >
          {pending ? <Spinner /> : installed ? <Settings2Icon /> : <DownloadIcon />}
          {pending ? "Wird installiert …" : installed ? "Einrichten" : "Installieren"}
        </Button>
      </div>
    </motion.article>
  );
}

import { Lightbulb } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect } from "react";
import { NewBadge } from "@/components/new-badge";
import { commitWaitTip, useWaitTip, type VisibleWaitTip } from "@/lib/discovery/wait-tips/current";
import { EASE_OUT } from "@/lib/ease";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { formatHotkeyDisplay, useResolvedHotkey } from "@/lib/hotkeys";

function tipText(tip: VisibleWaitTip, hotkey: string): string {
  return tip.text.replace("{hotkey}", hotkey ? formatHotkeyDisplay(hotkey) : "Ein Kürzel");
}

export function WaitTip() {
  const tip = useWaitTip();
  const reduce = useReducedMotion();
  const hotkey = useResolvedHotkey(tip?.hotkey ?? "");
  const { ref, isNew } = useNewFeatureVisibility<HTMLParagraphElement>("discover.wait-tips");
  useEffect(() => {
    if (tip) commitWaitTip();
  }, [tip]);
  if (!tip) return null;
  return (
    <motion.p
      key={tip.id}
      ref={ref}
      role="status"
      aria-live="polite"
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.25, ease: EASE_OUT }}
      className="flex max-w-md items-start gap-2 rounded-xl bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground"
    >
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-primary" />
      <span className="min-w-0">{tipText(tip, tip.hotkey ? hotkey : "")}</span>
      {isNew ? <NewBadge /> : null}
    </motion.p>
  );
}

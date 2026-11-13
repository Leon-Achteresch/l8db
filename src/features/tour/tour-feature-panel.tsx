import { ArrowLeft } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { featureShortcut } from "@/lib/ai/feature-search";
import { featureById } from "@/lib/discovery/catalog";
import { useTourStore } from "@/lib/tour/store";

interface Props {
  featureId: string;
}

export function TourFeaturePanel({ featureId }: Props) {
  const entry = featureById(featureId);
  const shortcut = entry ? featureShortcut(entry) : null;

  return (
    <motion.div
      key={featureId}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      data-tour-ui="feature"
    >
      <div className="flex items-center gap-2 px-4 pt-3.5">
        <span className="flex-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {entry?.area ?? "Funktion"}
        </span>
        {shortcut ? (
          <kbd className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </div>
      <h2 data-tour-ui="step-title" className="px-4 pt-2 text-[15px] font-semibold tracking-tight">
        {entry?.title ?? featureId}
      </h2>
      {entry?.summary ? (
        <p
          data-tour-ui="step-body"
          className="px-4 pt-1.5 text-[13px] leading-5 text-muted-foreground"
        >
          {entry.summary}
        </p>
      ) : null}
      <div className="flex justify-end px-3 pt-3 pb-3">
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-full px-4"
          onClick={() => useTourStore.getState().endDetour()}
        >
          <ArrowLeft className="size-3.5" />
          Zurück zur Tour
        </Button>
      </div>
    </motion.div>
  );
}

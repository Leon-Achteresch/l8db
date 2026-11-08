import { AnimatePresence } from "motion/react";
import { useEffect } from "react";
import { featureById } from "@/lib/discovery/catalog";
import { releaseSurface, useActiveSurface } from "@/lib/discovery/coordinator";
import { installFeedback } from "@/lib/discovery/feedback/controller";
import { useFeedbackStore } from "@/lib/discovery/feedback/store";
import { FeedbackCard } from "./feedback-card";

export default function FeedbackHost() {
  const active = useFeedbackStore((state) => state.active);
  const surface = useActiveSurface();

  useEffect(() => installFeedback(), []);

  const visible = Boolean(active && surface?.channel === "feedback" && surface.id === active);

  useEffect(() => {
    if (active && !visible) useFeedbackStore.getState().dismiss();
  }, [active, visible]);

  return (
    <AnimatePresence>
      {visible && active ? (
        <FeedbackCard
          key={active}
          featureId={active}
          title={featureById(active)?.title ?? active}
          onDone={() => releaseSurface("feedback", active)}
        />
      ) : null}
    </AnimatePresence>
  );
}

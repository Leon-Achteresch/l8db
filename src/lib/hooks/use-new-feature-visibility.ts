import { useEffect, useRef } from "react";
import { markNewFeatureSeen, type NewFeatureId, useHasNewFeatures } from "@/lib/new-features";

const VIEW_DURATION_MS = 3_000;

export function useNewFeatureVisibility<T extends HTMLElement>(featureId?: NewFeatureId) {
  const ref = useRef<T>(null);
  const isNew = useHasNewFeatures(featureId);

  useEffect(() => {
    const element = ref.current;
    if (!featureId || !isNew || !element || typeof IntersectionObserver === "undefined") return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let inViewport = false;

    const stopTimer = () => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        inViewport =
          document.visibilityState === "visible" &&
          Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5);
        if (!inViewport) {
          stopTimer();
          return;
        }
        if (timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (inViewport && document.visibilityState === "visible") markNewFeatureSeen(featureId);
        }, VIEW_DURATION_MS);
      },
      { threshold: 0.5 },
    );

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        inViewport = false;
        stopTimer();
        return;
      }
      observer.unobserve(element);
      observer.observe(element);
    };

    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stopTimer();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [featureId, isNew]);

  return { ref, isNew };
}

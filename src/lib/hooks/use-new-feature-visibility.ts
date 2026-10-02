import { useEffect, useRef } from "react";
import {
  createFeatureDwell,
  markNewFeatureSeen,
  type NewFeatureId,
  useHasNewFeatures,
} from "@/lib/new-features";

const VIEW_DURATION_MS = 2_000;

const startDwell = createFeatureDwell(VIEW_DURATION_MS, markNewFeatureSeen);

function isInView(entry: IntersectionObserverEntry | undefined): boolean {
  if (!entry?.isIntersecting || document.visibilityState !== "visible") return false;
  if (entry.intersectionRatio >= 0.5) return true;
  const rootHeight = entry.rootBounds?.height ?? window.innerHeight;
  const rootWidth = entry.rootBounds?.width ?? window.innerWidth;
  return entry.boundingClientRect.height > rootHeight || entry.boundingClientRect.width > rootWidth;
}

export function useNewFeatureVisibility<T extends HTMLElement>(featureId?: NewFeatureId) {
  const ref = useRef<T>(null);
  const isNew = useHasNewFeatures(featureId);

  useEffect(() => {
    const element = ref.current;
    if (!featureId || !isNew || !element) return;

    const onUse = () => markNewFeatureSeen(featureId);
    element.addEventListener("click", onUse);

    let stopDwell: (() => void) | undefined;
    const pause = () => {
      stopDwell?.();
      stopDwell = undefined;
    };

    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              if (!isInView(entries.at(-1))) pause();
              else stopDwell ??= startDwell(featureId);
            },
            { threshold: [0, 0.5] },
          );

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        pause();
        return;
      }
      observer?.unobserve(element);
      observer?.observe(element);
    };

    observer?.observe(element);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      pause();
      observer?.disconnect();
      element.removeEventListener("click", onUse);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [featureId, isNew]);

  return { ref, isNew };
}

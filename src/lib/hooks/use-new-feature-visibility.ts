import { useEffect, useRef } from "react";
import { markNewFeatureSeen, type NewFeatureId, useHasNewFeatures } from "@/lib/new-features";

export function useNewFeatureVisibility<T extends HTMLElement>(featureId?: NewFeatureId) {
  const ref = useRef<T>(null);
  const isNew = useHasNewFeatures(featureId);

  useEffect(() => {
    const element = ref.current;
    if (!featureId || !isNew || !element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          document.visibilityState === "visible" &&
          entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5)
        ) {
          markNewFeatureSeen(featureId);
        }
      },
      { threshold: 0.5 },
    );

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      observer.unobserve(element);
      observer.observe(element);
    };

    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [featureId, isNew]);

  return { ref, isNew };
}

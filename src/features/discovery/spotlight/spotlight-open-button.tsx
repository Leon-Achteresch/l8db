import { SparklesIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SpotlightOpenButton({ className }: { className?: string }) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLButtonElement>("discover.spotlight");
  return (
    <Button
      ref={ref}
      type="button"
      size="sm"
      variant="ghost"
      className={className}
      onClick={() =>
        void import("@/lib/discovery/spotlight/store").then(({ openSpotlight }) => openSpotlight())
      }
    >
      <SparklesIcon />
      Highlights
      {isNew && <NewBadge />}
    </Button>
  );
}

import { LayersIcon } from "lucide-react";

import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface MultiTargetButtonProps {
  disabled: boolean;
  running: boolean;
  onOpen: () => void;
}

export function MultiTargetButton({ disabled, running, onOpen }: MultiTargetButtonProps) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.multi-target");
  return (
    <Button
      ref={feature.ref}
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-3 text-xs"
      data-tour="query-multi-target"
      onClick={onOpen}
      disabled={disabled}
      title="Dieselbe Abfrage auf mehreren Datenbanken, Schemas oder Verbindungen ausführen"
    >
      <LayersIcon className={running ? "size-3 animate-pulse" : "size-3"} />
      Mehrere Ziele
      {feature.isNew && <NewBadge />}
    </Button>
  );
}

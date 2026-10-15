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
      className="h-7 gap-1.5 px-2 text-xs @min-[54rem]/qtb:px-3"
      data-tour="query-multi-target"
      onClick={onOpen}
      disabled={disabled}
      title="Dieselbe Abfrage auf mehreren Datenbanken, Schemas oder Verbindungen ausführen"
    >
      <LayersIcon className={running ? "size-3 animate-pulse" : "size-3"} />
      <span className="sr-only @min-[54rem]/qtb:not-sr-only">Mehrere Ziele</span>
      {feature.isNew && <NewBadge />}
    </Button>
  );
}

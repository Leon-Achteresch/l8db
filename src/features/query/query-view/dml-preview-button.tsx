import { ScanEyeIcon } from "lucide-react";

import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface DmlPreviewButtonProps {
  disabled: boolean;
  shortcut: string;
  onPreview: () => void;
}

export function DmlPreviewButton({ disabled, shortcut, onPreview }: DmlPreviewButtonProps) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.dml-preview");
  return (
    <Button
      ref={feature.ref}
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-3 text-xs"
      data-tour="query-dml-preview"
      onClick={onPreview}
      disabled={disabled}
      title={`Betroffene Zeilen eines UPDATE, DELETE, MERGE oder INSERT … SELECT anzeigen, ohne auszuführen (${shortcut})`}
    >
      <ScanEyeIcon className="size-3" />
      Vorschau
      {feature.isNew && <NewBadge />}
    </Button>
  );
}

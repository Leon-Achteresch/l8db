import { ScanEyeIcon } from "lucide-react";

import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

interface DmlPreviewButtonProps {
  disabled: boolean;
  disabledReason?: string;
  shortcut: string;
  onPreview: () => void;
}

export function DmlPreviewButton({
  disabled,
  disabledReason,
  shortcut,
  onPreview,
}: DmlPreviewButtonProps) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.dml-preview");
  return (
    <Button
      data-feature="query.dml-preview"
      data-hotkey="query.preview"
      ref={feature.ref}
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-2 text-xs @min-[54rem]/qtb:px-3"
      data-tour="query-dml-preview"
      onClick={onPreview}
      disabled={disabled}
      disabledReason={disabledReason}
      title={`Betroffene Zeilen eines UPDATE, DELETE, MERGE oder INSERT … SELECT anzeigen, ohne auszuführen (${shortcut})`}
    >
      <ScanEyeIcon className="size-3" />
      <span className="sr-only @min-[54rem]/qtb:not-sr-only">Vorschau</span>
      {feature.isNew && <NewBadge />}
    </Button>
  );
}

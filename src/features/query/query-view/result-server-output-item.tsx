import { TerminalIcon } from "lucide-react";
import { IconMenuCheckboxItem } from "@/components/icon-menu/icon-menu-checkbox-item";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ResultServerOutputItem({
  open,
  connected,
  onToggle,
}: {
  open: boolean;
  connected: boolean;
  onToggle: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.server-output");
  return (
    <IconMenuCheckboxItem
      ref={feature.ref}
      icon={<TerminalIcon />}
      label="Server-Ausgabe"
      checked={open}
      disabled={!connected}
      onCheckedChange={onToggle}
    />
  );
}

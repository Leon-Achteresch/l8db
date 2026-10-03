import { EyeOffIcon } from "lucide-react";
import { IconMenuCheckboxItem } from "@/components/icon-menu";
import { useActiveConnection } from "@/lib/connections";
import { useMaskingDisplay } from "@/lib/masking-display";

export function MaskingToggle() {
  const connection = useActiveConnection();
  const enabled = useMaskingDisplay((state) =>
    connection ? Boolean(state.enabled[connection.id]) : false,
  );
  const toggle = useMaskingDisplay((state) => state.toggle);
  if (!connection) return null;
  return (
    <IconMenuCheckboxItem
      icon={<EyeOffIcon />}
      label={enabled ? "Maskierung aktiv – Bearbeiten gesperrt" : "Maskierung anzeigen"}
      checked={enabled}
      onCheckedChange={() => toggle(connection.id)}
    />
  );
}

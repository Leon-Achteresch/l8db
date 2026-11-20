import { TerminalIcon } from "lucide-react";
import { IconMenuItem } from "@/components/icon-menu";
import { useServerOutputStore } from "@/lib/server-output";

export function TableServerOutputMenuItem({
  connectionId,
  database,
  onSelect,
}: {
  connectionId: string;
  database: string | null;
  onSelect: () => void;
}) {
  const count = useServerOutputStore(
    (state) =>
      state.entries[connectionId]?.reduce(
        (count, entry) => count + Number((entry.database ?? null) === database),
        0,
      ) ?? 0,
  );
  return (
    <IconMenuItem
      icon={<TerminalIcon />}
      label={`Server-Ausgabe${count > 0 ? ` · ${count}` : ""}`}
      onSelect={onSelect}
    />
  );
}

import { Database, X } from "lucide-react";

export function AiMentionChips({
  connections,
  disabled,
  onRemove,
}: {
  connections: { id: string; name: string }[];
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      {connections.map((connection) => (
        <button
          key={connection.id}
          type="button"
          disabled={disabled}
          aria-label={`Verbindung ${connection.name} aus Kontext entfernen`}
          className="flex h-6 items-center gap-1 rounded-full bg-muted px-2 text-[11px] text-foreground/85 outline-none transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onRemove(connection.id)}
        >
          <Database className="size-3 text-muted-foreground" />
          {connection.name}
          <X className="size-2.5 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

import { Save } from "lucide-react";
import { toast } from "sonner";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function TemporaryConnectionBadge({ className }: Props) {
  const connection = useActiveConnection();
  const save = useConnectionsStore((state) => state.saveTemporaryConnection);
  if (!connection?.temporary) return null;
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-sky-500/60 bg-sky-500/10 pl-2.5 pr-1 text-xs font-medium text-sky-700 dark:text-sky-400",
        className,
      )}
      title="Temporäre Verbindung: wird beim Beenden nicht gespeichert."
      role="status"
    >
      <span>Temporär</span>
      <button
        type="button"
        className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-full px-1.5 hover:bg-sky-500/15"
        onClick={() => {
          save(connection.id);
          toast.success(`„${connection.name}“ gespeichert`);
        }}
      >
        <Save className="size-3" />
        <span className="@max-[20rem]/header-search:sr-only">Verbindung speichern</span>
      </button>
    </span>
  );
}

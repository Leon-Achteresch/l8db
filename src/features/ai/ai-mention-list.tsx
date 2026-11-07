import type { ChatContextItem } from "@/lib/ai/chat-context";

export function AiMentionList({
  contexts,
  connections,
  onContext,
  onConnection,
}: {
  contexts: ChatContextItem[];
  connections: { id: string; name: string }[];
  onContext: (item: ChatContextItem) => void;
  onConnection: (id: string) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Kontext oder Verbindung erwähnen"
      className="mb-2 max-h-48 overflow-auto rounded-2xl bg-popover p-1 shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent),0_12px_32px_-12px_oklch(0_0_0/25%)]"
    >
      {contexts.map((item) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={false}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onContext(item)}
        >
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {item.kind === "table" ? item.schema || "Tabelle" : "Kontext"}
          </span>
        </button>
      ))}
      {connections.map((connection) => (
        <button
          key={connection.id}
          type="button"
          role="option"
          aria-selected={false}
          className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onConnection(connection.id)}
        >
          <span className="min-w-0 flex-1 truncate">{connection.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">Verbindung</span>
        </button>
      ))}
    </div>
  );
}

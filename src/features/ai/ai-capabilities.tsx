interface Props {
  metadata: Record<string, unknown>;
}
export function AiCapabilities({ metadata }: Props) {
  const groups = [
    { key: "tools", label: "Native Tools" },
    { key: "skills", label: "Native Skills" },
    { key: "mcpServers", label: "Native MCP-Server" },
    { key: "commands", label: "Agent-Befehle" },
  ];
  return (
    <section className="mt-5 space-y-3 border-t pt-5 text-xs">
      <h3 className="font-medium">Native Fähigkeiten</h3>
      {groups.map((group) => {
        const items = metadata[group.key];
        if (!Array.isArray(items) || !items.length) return null;
        return (
          <details key={group.key} className="rounded-lg bg-muted/20 px-3 py-2">
            <summary className="min-h-7 cursor-pointer py-1">
              {group.label} <span className="ml-1 text-muted-foreground">{items.length}</span>
            </summary>
            <ul className="mt-2 space-y-2 text-muted-foreground">
              {items.map((item, index) => {
                const value =
                  typeof item === "object" && item ? (item as Record<string, unknown>) : {};
                const name =
                  typeof item === "string"
                    ? item
                    : String(value.name ?? value.id ?? value.command ?? `Eintrag ${index + 1}`);
                return (
                  <li key={name}>
                    <span className="font-medium text-foreground">{name}</span>
                    {Boolean(value.description) && (
                      <p className="mt-0.5 leading-relaxed">{String(value.description)}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
      <details>
        <summary className="min-h-8 cursor-pointer py-1.5 text-muted-foreground">
          Weitere native Konfigurationsdetails
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/20 p-3 text-[11px]">
          {JSON.stringify(metadata, null, 2)}
        </pre>
      </details>
    </section>
  );
}

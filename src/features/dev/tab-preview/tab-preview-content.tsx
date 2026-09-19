interface TabPreviewContentProps {
  active: string;
  tabsCount: number;
  sidebar: boolean;
  split: boolean;
}

export function TabPreviewContent({ active, tabsCount, sidebar, split }: TabPreviewContentProps) {
  return (
    <div className="flex h-28 min-w-0 overflow-hidden">
      {sidebar && (
        <aside className="w-28 shrink-0 border-r bg-muted/20 p-3 text-xs text-muted-foreground">
          public<span className="mt-2 block text-foreground">{tabsCount} Tabellen</span>
        </aside>
      )}
      <div className="min-w-0 flex-1 overflow-x-auto">
        {active ? (
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Beispieldaten für {active}</caption>
            <thead className="bg-muted/20 text-muted-foreground">
              <tr>
                {["id", "Tabelle", "Status", "Aktualisiert"].map((heading) => (
                  <th key={heading} className="h-8 whitespace-nowrap border-b px-3 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2].map((id) => (
                <tr key={id} className="border-b border-border/40 last:border-0">
                  <td className="h-8 px-3 font-mono text-muted-foreground">{id}</td>
                  <td className="px-3 text-[11px]">{active}</td>
                  <td className="px-3 text-muted-foreground">Aktiv</td>
                  <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">
                    07.09.2026
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-6 text-xs text-muted-foreground">
            Keine Tabelle geöffnet. Mit + eine neue hinzufügen.
          </p>
        )}
      </div>
      {split && (
        <aside className="flex w-1/3 shrink-0 items-center justify-center border-l bg-muted/20 p-3 text-xs text-muted-foreground">
          Zweite Ansicht
        </aside>
      )}
    </div>
  );
}

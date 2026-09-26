import { ChevronDown, Search } from "lucide-react";
import { useState } from "react";
import type { ProviderInfo } from "@/lib/db";
import { cn } from "@/lib/utils";
import { matchesProvider, POPULAR_IDS, POPULAR_NOTES } from "./categories";
import { ProviderOption } from "./provider-option";

export function PopularPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: ProviderInfo[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const popular = POPULAR_IDS.flatMap(
    (id) => providers.find((provider) => provider.id === id) ?? [],
  );
  const rest = providers
    .filter((provider) => !POPULAR_IDS.includes(provider.id))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  const results = providers.filter((provider) => matchesProvider(provider, query));

  return (
    <div className="space-y-4">
      <label className="flex h-10 items-center gap-2 rounded-lg border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`${providers.length} Datenbanken durchsuchen, z. B. „Supabase“`}
          aria-label="Datenbank suchen"
          className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </label>
      {query ? (
        <div className="grid gap-0.5 sm:grid-cols-2">
          {results.map((provider) => (
            <ProviderOption
              key={provider.id}
              provider={provider}
              note={provider.group}
              selected={selected === provider.id}
              onSelect={() => onSelect(provider.id)}
            />
          ))}
          {!results.length && (
            <p className="col-span-full py-6 text-center text-xs text-muted-foreground">
              Nichts gefunden. Hast du eine Verbindungs-URL? Die erkennt l8db automatisch.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Die meisten starten hier</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {popular.map((provider) => (
                <ProviderOption
                  key={provider.id}
                  size="card"
                  provider={provider}
                  note={POPULAR_NOTES[provider.id]}
                  selected={selected === provider.id}
                  onSelect={() => onSelect(provider.id)}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
              className="flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                className={cn("size-3.5 transition-transform", !showAll && "-rotate-90")}
              />
              {showAll ? "Weniger anzeigen" : `Alle weiteren ${rest.length} anzeigen`}
            </button>
            {showAll && (
              <div className="grid gap-0.5 animate-in fade-in-0 duration-200 sm:grid-cols-3">
                {rest.map((provider) => (
                  <ProviderOption
                    key={provider.id}
                    provider={provider}
                    selected={selected === provider.id}
                    onSelect={() => onSelect(provider.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

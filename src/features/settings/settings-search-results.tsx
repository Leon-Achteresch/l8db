import { ArrowRight, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SEARCH_ITEMS } from "./settings-search-results/search-items";

interface SettingsSearchResultsProps {
  query: string;
  onSelectTab: (tabId: string) => void;
  onClearQuery: () => void;
}

export function SettingsSearchResults({
  query,
  onSelectTab,
  onClearQuery,
}: SettingsSearchResultsProps) {
  const normalized = query.trim().toLowerCase();

  const results = SEARCH_ITEMS.filter((item) => {
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      item.keywords.some((k) => k.toLowerCase().includes(normalized))
    );
  });

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center">
        <SearchX className="size-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">Keine Einstellungen gefunden</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Keine Treffer für &ldquo;{query}&rdquo;. Probiere einen anderen Suchbegriff.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onClearQuery}>
          Suche zurücksetzen
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {results.length} {results.length === 1 ? "Treffer" : "Treffer"} für &ldquo;{query}&rdquo;
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearQuery}>
          Zurück zur Kategorie
        </Button>
      </div>

      <div className="space-y-2">
        {results.map((result) => (
          <div
            key={result.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-card p-3 shadow-xs hover:border-primary/40 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{result.title}</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {result.tabLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{result.description}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              onClick={() => {
                onSelectTab(result.tabId);
                onClearQuery();
              }}
            >
              <span>Öffnen</span>
              <ArrowRight className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

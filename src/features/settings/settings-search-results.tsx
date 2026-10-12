import { ArrowRight, SearchX } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { SEARCH_ITEMS } from "./settings-search-results/search-items";

interface SettingsSearchResultsProps {
  query: string;
  modifiedOnly?: boolean;
  modified: ReadonlySet<string>;
  onSelectSetting: (tabId: string, settingId?: string) => void;
  onClearQuery: () => void;
}

export function SettingsSearchResults({
  query,
  modifiedOnly = false,
  modified,
  onSelectSetting,
  onClearQuery,
}: SettingsSearchResultsProps) {
  const normalized = query.trim().toLowerCase();
  const seenFeatures = useSeenNewFeatures();

  const results = SEARCH_ITEMS.filter((item) => {
    return (
      (!modifiedOnly || modified.has(item.id)) &&
      (item.title.toLowerCase().includes(normalized) ||
        item.description.toLowerCase().includes(normalized) ||
        item.keywords.some((k) => k.toLowerCase().includes(normalized)))
    );
  });

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center">
        <SearchX className="size-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">
          {modifiedOnly && !normalized
            ? "Keine geänderten Einstellungen"
            : "Keine Einstellungen gefunden"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {modifiedOnly && !normalized
            ? "Alle Einstellungen entsprechen den Standardwerten."
            : `Keine Treffer für „${query}“. Probiere einen anderen Suchbegriff.`}
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onClearQuery}>
          Filter zurücksetzen
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {results.length}{" "}
          {modifiedOnly
            ? results.length === 1
              ? "geänderte Einstellung"
              : "geänderte Einstellungen"
            : "Treffer"}
          {normalized ? ` für „${query}“` : ""}
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
                {modified.has(result.id) ? (
                  <Badge variant="secondary" className="text-[10px]">
                    Geändert
                  </Badge>
                ) : null}
                {hasNewFeatures(`settings.${result.tabId}.${result.id}`, seenFeatures) ? (
                  <NewBadge />
                ) : null}
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
                onSelectSetting(result.tabId, result.id);
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

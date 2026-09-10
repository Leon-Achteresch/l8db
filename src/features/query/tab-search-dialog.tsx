import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { RegexSearchHelper } from "@/components/regex-search-helper";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useQueryRevealStore } from "@/lib/query-reveal";
import { describeRegexError, insertRegexPattern } from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import { groupMatchesByTab, searchQueryTabs, type TabSearchSource } from "@/lib/tab-search";
import { useTableTabs } from "@/lib/table-tabs";

interface TabSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
  currentTabId?: string;
}

export function TabSearchDialog({
  open,
  onOpenChange,
  initialQuery,
  currentTabId,
}: TabSearchDialogProps) {
  const navigate = useNavigate();
  const tabs = useTableTabs((state) => state.tabs);
  const requestReveal = useQueryRevealStore((state) => state.requestReveal);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const regex = useRegexEnabled("tabs");
  const setRegexEnabled = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery?.trim() ? initialQuery.trim() : "");
    setTimeout(() => inputRef.current?.select(), 0);
  }, [open, initialQuery]);

  const sources = useMemo<TabSearchSource[]>(
    () =>
      tabs
        .filter((tab) => tab.kind === "query")
        .map((tab) => ({ id: tab.id, title: tab.title, sql: tab.sql })),
    [tabs],
  );

  const result = useMemo(
    () => searchQueryTabs(sources, query, { caseSensitive, wholeWord, regex }),
    [sources, query, caseSensitive, wholeWord, regex],
  );

  const groups = useMemo(() => groupMatchesByTab(result.matches), [result.matches]);

  const handleSelect = (tabId: string, line: number, column: number, length: number) => {
    requestReveal({ tabId, line, column, length });
    onOpenChange(false);
    void navigate({ to: "/query/$id", params: { id: tabId } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>In offenen Query-Tabs suchen</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={regex ? "Regulärer Ausdruck…" : "Suchtext…"}
            />
            <RegexSearchHelper
              enabled={regex}
              onEnabledChange={(enabled) => setRegexEnabled("tabs", enabled)}
              query={query}
              onQueryChange={setQuery}
              onInsert={(snippet) => {
                const input = inputRef.current;
                const start = input?.selectionStart ?? query.length;
                const end = input?.selectionEnd ?? query.length;
                const next = insertRegexPattern(query, start, end, snippet);
                setQuery(next.value);
                requestAnimationFrame(() => {
                  input?.focus();
                  input?.setSelectionRange(next.cursor, next.cursor);
                });
              }}
              error={result.patternError}
              matchCount={result.matches.length}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Switch
                id="tab-search-case"
                checked={caseSensitive}
                onCheckedChange={setCaseSensitive}
              />
              <Label htmlFor="tab-search-case" className="text-xs">
                Groß-/Kleinschreibung
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="tab-search-word" checked={wholeWord} onCheckedChange={setWholeWord} />
              <Label htmlFor="tab-search-word" className="text-xs">
                Ganzes Wort
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="tab-search-regex"
                checked={regex}
                onCheckedChange={(checked) => setRegexEnabled("tabs", checked)}
              />
              <Label htmlFor="tab-search-regex" className="text-xs">
                Regulärer Ausdruck
              </Label>
            </div>
            <span className="ml-auto tabular-nums">
              {sources.length} Tab{sources.length === 1 ? "" : "s"} · {result.matches.length}{" "}
              Treffer
              {result.truncated ? " (gekürzt)" : ""}
            </span>
          </div>

          {result.patternError && (
            <p className="text-xs text-destructive">{describeRegexError(result.patternError)}</p>
          )}

          <ScrollArea className="h-80 rounded-md border">
            {groups.length === 0 ? (
              <p className="p-4 text-xs text-muted-foreground">
                {query.trim()
                  ? "Keine Treffer in den offenen Query-Tabs."
                  : "Suchtext eingeben, um alle offenen Query-Tabs zu durchsuchen."}
              </p>
            ) : (
              <div className="divide-y">
                {groups.map((group) => (
                  <div key={group.tabId}>
                    <div className="sticky top-0 flex items-center gap-2 bg-card/95 px-3 py-1.5 text-xs font-medium">
                      <span className="truncate">{group.tabTitle}</span>
                      {group.tabId === currentTabId && (
                        <span className="text-muted-foreground">(aktiv)</span>
                      )}
                      <span className="ml-auto tabular-nums text-muted-foreground">
                        {group.matches.length}
                      </span>
                    </div>
                    {group.matches.map((match) => (
                      <Button
                        key={`${match.tabId}-${match.line}-${match.column}`}
                        variant="ghost"
                        className="h-auto w-full justify-start gap-3 rounded-none px-3 py-1.5 text-left font-mono text-xs"
                        onClick={() =>
                          handleSelect(match.tabId, match.line, match.column, match.length)
                        }
                      >
                        <span className="w-10 shrink-0 tabular-nums text-muted-foreground">
                          {match.line}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {match.preview.slice(0, match.previewStart)}
                          <mark className="bg-primary/25 text-foreground">
                            {match.preview.slice(
                              match.previewStart,
                              match.previewStart + match.previewLength,
                            )}
                          </mark>
                          {match.preview.slice(match.previewStart + match.previewLength)}
                        </span>
                      </Button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}

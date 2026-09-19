import { ArrowDownIcon, ArrowUpIcon, SearchIcon, XIcon } from "lucide-react";
import type { RefObject } from "react";
import { RegexSearchHelper } from "@/components/regex-search-helper";
import { describeGridSearch } from "@/lib/grid-search";
import { describeRegexError, insertRegexPattern } from "@/lib/regex-search";
import { cn } from "@/lib/utils";
import type { useGridSearch } from "./use-grid-search";

type Props = {
  search: ReturnType<typeof useGridSearch>;
  loadedRowCount: number;
  visibleColumnCount: number;
};

export function DataTableSearchBar({ search, loadedRowCount, visibleColumnCount }: Props) {
  const {
    searchMode,
    setSearchMode,
    searchQuery,
    setSearchQuery,
    searchRegex,
    setSearchRegex,
    searchError,
    columnMatches,
    matchIndex,
    matches,
    navCount,
    closeSearch,
    stepMatch,
  } = search;
  const searchInputRef: RefObject<HTMLInputElement | null> = search.searchInputRef;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
      <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="flex shrink-0 overflow-hidden rounded border border-border text-[11px]">
        <button
          type="button"
          onClick={() => setSearchMode("rows")}
          className={cn(
            "px-2 py-0.5 cursor-pointer",
            searchMode === "rows" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
        >
          Zeilen
        </button>
        <button
          type="button"
          onClick={() => setSearchMode("columns")}
          className={cn(
            "border-l border-border px-2 py-0.5 cursor-pointer",
            searchMode === "columns" ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
          )}
        >
          Spalten
        </button>
      </div>
      <input
        ref={searchInputRef}
        value={searchQuery}
        // biome-ignore lint/a11y/noAutofocus: Suchfeld wird gezielt geöffnet
        autoFocus
        placeholder={
          searchMode === "columns"
            ? "Spaltennamen suchen…"
            : searchRegex
              ? "Regex in geladenen Zeilen…"
              : "In geladenen Zeilen suchen…"
        }
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            closeSearch();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            stepMatch(event.shiftKey ? -1 : 1);
          }
        }}
        className="h-6 min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/60"
      />
      <span
        className={cn(
          "shrink-0 font-mono text-[11px] tabular-nums",
          searchError ? "text-destructive" : "text-muted-foreground",
        )}
        title={searchError ? describeRegexError(searchError) : undefined}
      >
        {searchMode === "columns"
          ? describeGridSearch(columnMatches.length, matchIndex)
          : searchError
            ? describeRegexError(searchError)
            : describeGridSearch(matches.length, matchIndex)}
      </span>
      {searchMode === "rows" && (
        <RegexSearchHelper
          enabled={searchRegex}
          onEnabledChange={(enabled) => setSearchRegex("grid", enabled)}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          onInsert={(snippet) => {
            const input = searchInputRef.current;
            const start = input?.selectionStart ?? searchQuery.length;
            const end = input?.selectionEnd ?? searchQuery.length;
            const next = insertRegexPattern(searchQuery, start, end, snippet);
            setSearchQuery(next.value);
            requestAnimationFrame(() => {
              input?.focus();
              input?.setSelectionRange(next.cursor, next.cursor);
            });
          }}
          error={searchError}
          matchCount={matches.length}
        />
      )}
      {searchMode === "rows" && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {loadedRowCount} geladene {loadedRowCount === 1 ? "Zeile" : "Zeilen"} ·{" "}
          {visibleColumnCount} sichtbare Spalten
        </span>
      )}
      <button
        type="button"
        title="Vorheriger Treffer"
        disabled={navCount === 0}
        onClick={() => stepMatch(-1)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
      >
        <ArrowUpIcon className="size-3.5" />
      </button>
      <button
        type="button"
        title="Nächster Treffer"
        disabled={navCount === 0}
        onClick={() => stepMatch(1)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
      >
        <ArrowDownIcon className="size-3.5" />
      </button>
      <button
        type="button"
        title="Suche schließen"
        onClick={closeSearch}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-accent cursor-pointer"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}

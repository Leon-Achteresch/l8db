import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { rankCommands } from "@/lib/command-score";
import { gridMatchKey, runGridSearch, stepMatchIndex } from "@/lib/grid-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import type { TableRow } from "../data-table-types";

export function useGridSearch(data: TableRow[], searchColumns: string[]) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"rows" | "columns">("columns");
  const searchRegex = useRegexEnabled("grid");
  const setSearchRegex = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const [matchIndex, setMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchResult = useMemo(
    () =>
      searchOpen && searchMode === "rows"
        ? runGridSearch(data, searchColumns, deferredSearchQuery, { regex: searchRegex })
        : { matches: [], error: null },
    [searchOpen, searchMode, data, searchColumns, deferredSearchQuery, searchRegex],
  );
  const matches = searchResult.matches;
  const searchError = searchResult.error;
  const matchKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const match of matches) keys.add(gridMatchKey(match.rowIndex, match.columnId));
    return keys;
  }, [matches]);
  const activeMatch = matches[matchIndex] ?? null;

  const columnMatches = useMemo(() => {
    if (searchMode !== "columns") return [];
    if (deferredSearchQuery.trim() === "") return [];
    return rankCommands(
      searchColumns.map((label) => ({ label })),
      deferredSearchQuery,
    ).map((item) => item.label);
  }, [searchMode, deferredSearchQuery, searchColumns]);
  const navCount = searchMode === "columns" ? columnMatches.length : matches.length;
  const activeColumnMatch = searchMode === "columns" ? (columnMatches[matchIndex] ?? null) : null;

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setMatchIndex(0);
  }, []);

  const stepMatch = useCallback(
    (step: number) => {
      setMatchIndex((current) => stepMatchIndex(current, navCount, step));
    },
    [navCount],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Treffer neu zählen bei Query- oder Datenwechsel
  useEffect(() => {
    setMatchIndex(0);
  }, [searchQuery, data, searchMode]);

  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchMode,
    setSearchMode,
    searchRegex,
    setSearchRegex,
    matchIndex,
    searchInputRef,
    matches,
    searchError,
    matchKeys,
    activeMatch,
    columnMatches,
    navCount,
    activeColumnMatch,
    closeSearch,
    stepMatch,
  };
}

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { rankCommands } from "@/lib/command-score";
import { runGridSearch, stepMatchIndex } from "@/lib/grid-search";
import { cellsByRow } from "@/lib/grid-selection";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import type { TableRow } from "../data-table-types";

export function useGridSearch(data: TableRow[], searchColumns: string[], resetKey: unknown) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<"rows" | "columns">("columns");
  const searchRegex = useRegexEnabled("grid");
  const setSearchRegex = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const [matchIndex, setMatchIndex] = useState(0);
  const [navSeq, setNavSeq] = useState(0);
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
  const matchesByRow = useMemo(() => cellsByRow(matches), [matches]);
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
      setNavSeq((seq) => seq + 1);
    },
    [navCount],
  );

  const activeRow = useRef<{ row: TableRow; columnId: string } | null>(null);
  useEffect(() => {
    const target = activeRow.current;
    if (!target) return;
    const index = matches.findIndex(
      (match) => match.columnId === target.columnId && data[match.rowIndex] === target.row,
    );
    if (index >= 0) setMatchIndex(index);
  }, [matches, data]);
  useEffect(() => {
    activeRow.current = activeMatch && {
      row: data[activeMatch.rowIndex],
      columnId: activeMatch.columnId,
    };
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: Treffer neu zählen bei Query- oder Datenwechsel
  useEffect(() => {
    setMatchIndex(0);
    if (searchOpen) setNavSeq((seq) => seq + 1);
  }, [deferredSearchQuery, resetKey, searchMode, searchRegex, searchOpen]);

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
    matchesByRow,
    activeMatch,
    navSeq,
    columnMatches,
    navCount,
    activeColumnMatch,
    closeSearch,
    stepMatch,
  };
}

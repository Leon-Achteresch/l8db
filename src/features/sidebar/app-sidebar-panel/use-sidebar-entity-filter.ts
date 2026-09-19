import { useDeferredValue, useMemo } from "react";
import { useColumnsQuery } from "@/lib/queries";
import { compileSearchPatterns, splitSearchPatterns } from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import { useSettingsStore } from "@/lib/settings";
import { useSidebarSearch } from "@/lib/sidebar-search";

export function useSidebarEntityFilter(
  items: { schema: string; name: string }[] | undefined,
  type: "table" | "view",
) {
  const [search, setSearch] = useSidebarSearch(type === "table" ? "tables" : "views");
  const searchIncludeColumns = useSettingsStore((state) => state.searchIncludeColumns);
  const setSearchIncludeColumns = useSettingsStore((state) => state.setSearchIncludeColumns);
  const regexEnabled = useRegexEnabled("sidebar");
  const setRegexEnabled = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const { data: columns } = useColumnsQuery(
    type === "table" ? "BASE TABLE" : "VIEW",
    search.trim().length > 0 && searchIncludeColumns,
  );

  const columnsByTable = useMemo(() => {
    if (!columns) return new Map<string, string[]>();
    const map = new Map<string, string[]>();
    for (const col of columns) {
      const key = `${col.schema}.${col.table}`;
      const arr = map.get(key);
      if (arr) {
        arr.push(col.name);
      } else {
        map.set(key, [col.name]);
      }
    }
    return map;
  }, [columns]);

  const deferredSearch = useDeferredValue(search);
  const compiled = useMemo(
    () =>
      regexEnabled && deferredSearch.trim() !== ""
        ? compileSearchPatterns(deferredSearch, { global: false })
        : null,
    [regexEnabled, deferredSearch],
  );
  const regexError = compiled && !compiled.ok ? compiled.error : null;
  const filtered = useMemo(() => {
    if (!items) return undefined;
    const patterns = splitSearchPatterns(deferredSearch);
    if (patterns.length === 0)
      return items.map((item) => ({ ...item, matchingColumns: [] as string[] }));
    if (compiled && !compiled.ok) {
      return items.map((item) => ({ ...item, matchingColumns: [] as string[] }));
    }
    const matches = compiled?.ok
      ? (value: string) => compiled.regexes.some((regex) => regex.test(value))
      : (value: string) => {
          const lower = value.toLowerCase();
          return patterns.some((pattern) => lower.includes(pattern.toLowerCase()));
        };
    return items
      .map((item) => {
        const nameMatch = matches(item.name);
        if (!searchIncludeColumns) {
          return nameMatch ? { ...item, matchingColumns: [] as string[] } : null;
        }
        const key = `${item.schema}.${item.name}`;
        const cols = columnsByTable.get(key) ?? [];
        const matchingColumns = cols.filter(matches);
        if (nameMatch || matchingColumns.length > 0) {
          return { ...item, matchingColumns };
        }
        return null;
      })
      .filter(
        (item): item is { schema: string; name: string; matchingColumns: string[] } =>
          item !== null,
      );
  }, [items, deferredSearch, columnsByTable, searchIncludeColumns, compiled]);

  return {
    search,
    setSearch,
    searchIncludeColumns,
    setSearchIncludeColumns,
    regexEnabled,
    setRegexEnabled,
    regexError,
    filtered,
  };
}

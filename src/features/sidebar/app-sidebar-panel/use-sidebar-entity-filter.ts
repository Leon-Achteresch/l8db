import { useDeferredValue, useMemo } from "react";
import { useColumnsQuery } from "@/lib/queries";
import { compileSearchPatterns, searchMatcher } from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import { useSettingsStore } from "@/lib/settings";
import { useSidebarSearch } from "@/lib/sidebar-search";

export interface SidebarEntityMatch {
  schema: string;
  name: string;
  matchingColumns?: string[];
}

export function matchingColumnsWindow(filtered: SidebarEntityMatch[]) {
  if (!filtered.some((item) => Boolean(item.matchingColumns?.length))) return undefined;
  const columns = (index: number) => filtered[index].matchingColumns?.length ?? 0;
  return {
    estimateSize: (index: number) => (columns(index) ? 35 + 25 * columns(index) : 32),
    getItemKey: (index: number) =>
      `${filtered[index].schema}.${filtered[index].name}:${columns(index)}`,
  };
}

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
  const filtered = useMemo<SidebarEntityMatch[] | undefined>(() => {
    if (!items) return undefined;
    const matches = searchMatcher(deferredSearch, compiled);
    if (!matches) return items;
    const result: SidebarEntityMatch[] = [];
    for (const item of items) {
      const nameMatch = matches(item.name);
      if (!searchIncludeColumns) {
        if (nameMatch) result.push(item);
        continue;
      }
      const cols = columnsByTable.get(`${item.schema}.${item.name}`) ?? [];
      const matchingColumns = cols.filter(matches);
      if (nameMatch || matchingColumns.length > 0) result.push({ ...item, matchingColumns });
    }
    return result;
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

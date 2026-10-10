import { useDeferredValue, useMemo } from "react";
import { usePackageMembersQuery } from "@/lib/queries";
import { compileSearchPatterns } from "@/lib/regex-search";
import { useRegexEnabled, useRegexSearchPrefs } from "@/lib/regex-search-prefs";
import { useSettingsStore } from "@/lib/settings";
import { useSidebarSearch } from "@/lib/sidebar-search";
import { filterPackages, groupPackageMembers, matchingMembersWindow } from "./filter-packages";

export function usePackageFilter(items: { schema: string; name: string }[] | undefined) {
  const [search, setSearch] = useSidebarSearch("packages");
  const deferredSearch = useDeferredValue(search);
  const searchIncludePackageMembers = useSettingsStore(
    (state) => state.searchIncludePackageMembers,
  );
  const setSearchIncludePackageMembers = useSettingsStore(
    (state) => state.setSearchIncludePackageMembers,
  );
  const regexEnabled = useRegexEnabled("sidebar");
  const setRegexEnabled = useRegexSearchPrefs((state) => state.setRegexEnabled);
  const compiled = useMemo(
    () =>
      regexEnabled && deferredSearch.trim()
        ? compileSearchPatterns(deferredSearch, { global: false })
        : null,
    [regexEnabled, deferredSearch],
  );
  const regexError = compiled && !compiled.ok ? compiled.error : null;
  const memberSearchEnabled =
    Boolean(items?.length) &&
    searchIncludePackageMembers &&
    Boolean(deferredSearch.trim()) &&
    !regexError;
  const members = usePackageMembersQuery(memberSearchEnabled);
  const membersByPackage = useMemo(() => groupPackageMembers(members.data), [members.data]);
  const filtered = useMemo(
    () =>
      filterPackages(
        items,
        membersByPackage,
        deferredSearch,
        searchIncludePackageMembers,
        compiled,
      ),
    [items, membersByPackage, deferredSearch, searchIncludePackageMembers, compiled],
  );
  const measured = useMemo(() => matchingMembersWindow(filtered ?? []), [filtered]);

  return {
    search,
    setSearch,
    searchIncludePackageMembers,
    setSearchIncludePackageMembers,
    regexEnabled,
    setRegexEnabled,
    regexError,
    filtered,
    measured,
    isMembersLoading: memberSearchEnabled && members.isPending,
    membersError: memberSearchEnabled && members.isError ? members.error : null,
  };
}

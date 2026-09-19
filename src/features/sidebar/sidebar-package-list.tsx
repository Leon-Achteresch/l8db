import { SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import { SidebarInput, SidebarMenu } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { useSidebarSearch } from "@/lib/sidebar-search";

import { PackageNode } from "./sidebar-package-list/package-node";

interface SidebarPackageListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarPackageList({ items, isLoading, isError, error }: SidebarPackageListProps) {
  const [search, setSearch] = useSidebarSearch("packages");
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return items;
    return items?.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, deferredSearch]);
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
        <Spinner />
        Lade Packages…
      </div>
    );
  }
  if (isError) {
    return <SidebarQueryError error={error} />;
  }
  if (!items || items.length === 0) {
    return <p className="py-1 text-sm text-muted-foreground">Keine Packages gefunden.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="sticky top-0 z-10 bg-sidebar py-1">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <SidebarInput
          placeholder="Packages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>
      {filtered && filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarMenu>
          {filtered?.map((item) => (
            <PackageNode
              key={`${item.schema}.${item.name}`}
              schema={item.schema}
              name={item.name}
            />
          ))}
        </SidebarMenu>
      )}
    </div>
  );
}

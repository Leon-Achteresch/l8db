import { useNavigate } from "@tanstack/react-router";
import { BracesIcon, ChevronRightIcon, PackageIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { buildInvalidSet, isPackageInvalid, isPackagePartInvalid } from "@/lib/invalid-objects";
import { type PackagePart, packageOid, parsePlsqlMembers } from "@/lib/plsql";
import { useFunctionDefinitionQuery, useInvalidObjectsQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

interface SidebarPackageListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

export function SidebarPackageList({ items, isLoading, isError, error }: SidebarPackageListProps) {
  const [search, setSearch] = useState("");
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
      <div className="relative">
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

function usePackageNavigate(schema: string, name: string) {
  const navigate = useNavigate();
  const openPackageTab = useTableTabs((state) => state.openPackageTab);
  return (part?: PackagePart, member?: string) => {
    openPackageTab({ schema, name });
    void navigate({
      to: "/packages/$schema/$name",
      params: { schema, name },
      search: { part, member },
    });
  };
}

function PackageNode({ schema, name }: { schema: string; name: string }) {
  const go = usePackageNavigate(schema, name);
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const invalid = isPackageInvalid(invalidSet, schema, name);
  return (
    <Collapsible asChild className="group/pkg">
      <SidebarMenuItem>
        <SidebarMenuButton onClick={() => go()}>
          <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
            <ChevronRightIcon className="transition-transform group-data-[state=open]/pkg:rotate-90" />
          </CollapsibleTrigger>
          <PackageIcon className="text-muted-foreground" />
          <span className="truncate">{name}</span>
          {invalid ? <InvalidMarker /> : null}
        </SidebarMenuButton>
        <CollapsibleContent>
          <SidebarMenuSub>
            <PartNode schema={schema} name={name} part="spec" title="Spec" />
            <PartNode schema={schema} name={name} part="body" title="Body" />
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function PartNode({
  schema,
  name,
  part,
  title,
}: {
  schema: string;
  name: string;
  part: PackagePart;
  title: string;
}) {
  const go = usePackageNavigate(schema, name);
  const { data, isLoading, isError } = useFunctionDefinitionQuery(packageOid(schema, name, part));
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const invalid = isPackagePartInvalid(invalidSet, schema, name, part);
  const members = data ? parsePlsqlMembers(data) : [];
  return (
    <Collapsible asChild defaultOpen className="group/part">
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild>
          <button type="button" className="w-full" onClick={() => go(part)}>
            <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
              <ChevronRightIcon className="transition-transform group-data-[state=open]/part:rotate-90" />
            </CollapsibleTrigger>
            <span className="truncate">{title}</span>
            {invalid ? <InvalidMarker /> : null}
            {isLoading ? <Spinner className="ml-auto" /> : null}
          </button>
        </SidebarMenuSubButton>
        <CollapsibleContent>
          <SidebarMenuSub>
            {isError ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">Nicht verfügbar</p>
            ) : (
              members.map((m) => (
                <SidebarMenuSubItem key={`${m.kind}:${m.name}`}>
                  <SidebarMenuSubButton asChild size="sm">
                    <button type="button" className="w-full" onClick={() => go(part, m.name)}>
                      <BracesIcon className="text-muted-foreground" />
                      <span className="truncate">{m.name}</span>
                    </button>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  );
}

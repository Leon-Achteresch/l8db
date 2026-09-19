import { BracesIcon, ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { buildInvalidSet, isPackagePartInvalid } from "@/lib/invalid-objects";
import { type PackagePart, packageOid, parsePlsqlMembers } from "@/lib/plsql";
import { useFunctionDefinitionQuery, useInvalidObjectsQuery } from "@/lib/queries";

import { usePackageNavigate } from "./use-package-navigate";

export function PartNode({
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
                <SidebarMenuSubItem key={`${m.kind}:${m.name}:${m.line}`}>
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

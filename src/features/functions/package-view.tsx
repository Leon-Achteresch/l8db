import { getRouteApi } from "@tanstack/react-router";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import { Accordion, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { SqlEditorPane } from "@/features/functions/function-view";
import { useActiveConnection } from "@/lib/connections";
import { type PackagePart, packageOid, parsePlsqlMembers } from "@/lib/plsql";
import { useFunctionDefinitionQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

const routeApi = getRouteApi("/_app/packages/$schema/$name");

export function PackageView() {
  const { schema, name } = routeApi.useParams();
  const { part, member } = routeApi.useSearch();
  const connection = useActiveConnection();
  const openPackageTab = useTableTabs((state) => state.openPackageTab);
  const [open, setOpen] = useState<string[]>(part ? [part] : ["spec", "body"]);

  useEffect(() => {
    openPackageTab({ schema, name });
  }, [schema, name, openPackageTab]);

  useEffect(() => {
    if (part) setOpen([part]);
  }, [part, member]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground flex-1">
          {schema}.{name}
        </span>
      </div>
      <Accordion
        type="multiple"
        value={open}
        onValueChange={setOpen}
        className="min-h-0 flex-1 px-4"
      >
        <PackagePartPanel
          title="Spec"
          part="spec"
          oid={packageOid(schema, name, "spec")}
          member={part === "spec" ? member : undefined}
        />
        <PackagePartPanel
          title="Body"
          part="body"
          oid={packageOid(schema, name, "body")}
          member={part === "body" ? member : undefined}
        />
      </Accordion>
    </div>
  );
}

function PackagePartPanel({
  title,
  part,
  oid,
  member,
}: {
  title: string;
  part: PackagePart;
  oid: string;
  member?: string;
}) {
  const { data, isLoading, isError, error } = useFunctionDefinitionQuery(oid);
  const revealLine = member
    ? parsePlsqlMembers(data ?? "").find((m) => m.name === member.toUpperCase())?.line
    : undefined;
  return (
    <AccordionItem value={part} className="flex min-h-0 flex-col data-[state=open]:flex-1">
      <AccordionTrigger className="py-2">{title}</AccordionTrigger>
      <AccordionPrimitive.Content className="flex min-h-0 flex-1 flex-col pb-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 bg-muted/30" style={{ width: `${60 + i * 5}%` }} />
            ))}
          </div>
        ) : isError ? (
          <p className="text-xs text-muted-foreground">{String(error)}</p>
        ) : (
          <div className="min-h-0 flex-1 rounded-md border">
            <SqlEditorPane value={data ?? ""} readOnly revealLine={revealLine} />
          </div>
        )}
      </AccordionPrimitive.Content>
    </AccordionItem>
  );
}

import { HammerIcon, LoaderIcon } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import { useEffect, useState } from "react";

import { Accordion, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SqlEditorPane } from "@/features/functions/function-view";
import { useCompileObject } from "@/features/functions/use-compile-object";
import {
  OpenInQueryEditorButton,
  SqlEditActions,
  SqlEditFeedback,
  SqlEditHint,
  useSqlObjectEdit,
} from "@/features/functions/use-sql-object-edit";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { type PackagePart, packageOid, parsePlsqlMembers } from "@/lib/plsql";
import { useFunctionDefinitionQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

export interface PackageViewProps {
  schema: string;
  name: string;
  part?: PackagePart;
  member?: string;
}

export function PackageView({ schema, name, part, member }: PackageViewProps) {
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
          label={`${schema}.${name} (Spec)`}
          oid={packageOid(schema, name, "spec")}
          member={part === "spec" ? member : undefined}
        />
        <PackagePartPanel
          title="Body"
          part="body"
          label={`${schema}.${name} (Body)`}
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
  label,
  oid,
  member,
}: {
  title: string;
  part: PackagePart;
  label: string;
  oid: string;
  member?: string;
}) {
  const { data, isLoading, isError, error } = useFunctionDefinitionQuery(oid);
  const capabilities = useActiveCapabilities();
  const { compile, state: compileState } = useCompileObject();
  const edit = useSqlObjectEdit(label, data ?? "");
  const compileResult = compileState.status === "done" ? compileState.result : null;
  const revealLine = member
    ? parsePlsqlMembers(data ?? "").find((m) => m.name === member.toUpperCase())?.line
    : undefined;
  return (
    <AccordionItem value={part} className="flex min-h-0 flex-col data-[state=open]:flex-1">
      <div className="flex items-center gap-2">
        <AccordionTrigger className="py-2">{title}</AccordionTrigger>
        {compileResult ? (
          <Badge variant={compileResult.status === "VALID" ? "outline" : "destructive"}>
            {compileResult.status}
          </Badge>
        ) : null}
        <span className="ml-auto" />
        <OpenInQueryEditorButton sql={data ?? ""} title={label} />
        {!edit.editing && capabilities.compile_objects ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void compile(oid, part === "spec" ? "package_spec" : "package_body", label)
            }
            disabled={compileState.status === "loading"}
            title="Kompiliert das gespeicherte Objekt in der Datenbank neu — ohne den Quelltext zu ändern."
          >
            {compileState.status === "loading" ? (
              <LoaderIcon data-icon="inline-start" className="animate-spin" />
            ) : (
              <HammerIcon data-icon="inline-start" />
            )}
            Kompilieren
          </Button>
        ) : null}
        <SqlEditActions edit={edit} />
      </div>
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
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {edit.editing ? <SqlEditHint /> : null}
            <div className="min-h-0 flex-1 rounded-md border">
              <SqlEditorPane
                value={edit.editing ? edit.sql : (data ?? "")}
                readOnly={!edit.editing}
                onChange={edit.editing ? edit.setSql : undefined}
                revealLine={compileResult?.line ?? revealLine}
              />
            </div>
            <SqlEditFeedback state={edit.state} />
            {compileResult && compileResult.status !== "VALID" ? (
              <div className="flex flex-col gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                <span className="text-xs font-semibold text-destructive">
                  Kompilierfehler
                  {compileResult.line ? ` in Zeile ${compileResult.line}` : ""}
                </span>
                <pre className="whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
                  {compileResult.message}
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </AccordionPrimitive.Content>
    </AccordionItem>
  );
}

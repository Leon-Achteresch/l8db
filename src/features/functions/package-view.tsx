import { HammerIcon, LoaderIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SqlEditorPane } from "@/features/functions/function-view";
import { PackageMemberOutline } from "@/features/functions/package-member-outline";
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
  const capabilities = useActiveCapabilities();
  const [activePart, setActivePart] = useState<PackagePart>(part ?? "body");
  const [activeMember, setActiveMember] = useState(member?.toUpperCase());
  const spec = useFunctionDefinitionQuery(packageOid(schema, name, "spec"));
  const body = useFunctionDefinitionQuery(packageOid(schema, name, "body"));
  const current = activePart === "spec" ? spec : body;
  const source = current.data ?? "";
  const label = `${schema}.${name} (${activePart === "spec" ? "Spec" : "Body"})`;
  const oid = packageOid(schema, name, activePart);
  const edit = useSqlObjectEdit(label, source);
  const { compile, state: compileState, reset: resetCompile } = useCompileObject();
  const compileResult = compileState.status === "done" ? compileState.result : null;
  const members = parsePlsqlMembers(edit.editing ? edit.sql : source);
  const revealLine = activeMember
    ? members.find((m) => m.name === activeMember)?.line
    : members[0]?.line;

  useEffect(() => {
    openPackageTab({ schema, name });
  }, [schema, name, openPackageTab]);

  useEffect(() => {
    if (part) setActivePart(part);
    setActiveMember(member?.toUpperCase());
  }, [part, member]);

  useEffect(() => {
    resetCompile();
  }, [activePart, resetCompile]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">{schema}.</span>
        <span className="text-xs font-semibold">{name}</span>
        <Tabs
          value={activePart}
          onValueChange={(value) => {
            const next = value === "spec" ? "spec" : "body";
            if (next === activePart) return;
            if (edit.editing) edit.cancel();
            setActivePart(next);
            setActiveMember(undefined);
          }}
        >
          <TabsList variant="default" className="h-7">
            <TabsTrigger value="spec" className="h-6 px-2.5 text-xs" disabled={edit.editing}>
              Spec
            </TabsTrigger>
            <TabsTrigger value="body" className="h-6 px-2.5 text-xs" disabled={edit.editing}>
              Body
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {compileResult ? (
          <Badge variant={compileResult.status === "VALID" ? "outline" : "destructive"}>
            {compileResult.status}
          </Badge>
        ) : null}
        <span className="ml-auto" />
        <OpenInQueryEditorButton sql={source} title={label} />
        {!edit.editing && capabilities.compile_objects ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() =>
              void compile(oid, activePart === "spec" ? "package_spec" : "package_body", label)
            }
            disabled={compileState.status === "loading" || current.isLoading}
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

      {edit.editing ? <SqlEditHint /> : null}

      {current.isLoading ? (
        <div className="flex-1 overflow-hidden bg-background p-4 space-y-3">
          <Skeleton className="h-6 w-64 bg-muted/50" />
          <div className="space-y-2 mt-4">
            {Array.from({ length: 15 }).map((_, i) => (
              <Skeleton key={i} className="h-5 bg-muted/30" style={{ width: `${60 + i * 2}%` }} />
            ))}
          </div>
        </div>
      ) : current.isError ? (
        <div className="flex flex-1 items-center justify-center p-6 bg-background">
          <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
            <TriangleAlertIcon className="size-8 text-destructive" />
            <h3 className="text-sm font-semibold text-destructive">
              Fehler beim Laden ({activePart === "spec" ? "Spec" : "Body"})
            </h3>
            <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
              {String(current.error)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {members.length > 0 ? (
            <PackageMemberOutline
              members={members}
              activeName={activeMember}
              onSelect={(m) => setActiveMember(m.name)}
            />
          ) : null}
          <div className="flex min-h-0 flex-1 flex-col">
            <SqlEditorPane
              value={edit.editing ? edit.sql : source}
              readOnly={!edit.editing}
              onChange={edit.editing ? edit.setSql : undefined}
              revealLine={compileResult?.line ?? revealLine}
            />
            {compileResult && compileResult.status !== "VALID" ? (
              <div className="flex flex-col gap-1 border-t bg-destructive/5 px-4 py-2.5">
                <span className="text-xs font-semibold text-destructive">
                  Kompilierfehler
                  {compileResult.line ? ` in Zeile ${compileResult.line}` : ""}
                </span>
                <pre className="whitespace-pre-wrap break-all text-xs font-mono text-destructive select-text">
                  {compileResult.message}
                </pre>
              </div>
            ) : null}
            <SqlEditFeedback state={edit.state} />
          </div>
        </div>
      )}
    </div>
  );
}

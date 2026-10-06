import { useQueryClient } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SidebarInput } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { SidebarWindow } from "@/features/sidebar/sidebar-window";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, type SchemaCopyObjectType } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { buildInvalidSet, isPackageInvalid } from "@/lib/invalid-objects";
import { type PackagePart, packageOid } from "@/lib/plsql";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { useSidebarSearch } from "@/lib/sidebar-search";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

import { type DropKind, PackageNode } from "./sidebar-package-list/package-node";

interface SidebarPackageListProps {
  items: { schema: string; name: string }[] | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

interface DropTarget {
  schema: string;
  name: string;
  kind: DropKind;
}

export function SidebarPackageList({ items, isLoading, isError, error }: SidebarPackageListProps) {
  const [search, setSearch] = useSidebarSearch("packages");
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    if (!q) return items;
    return items?.filter((item) => item.name.toLowerCase().includes(q));
  }, [items, deferredSearch]);
  const capabilities = useActiveCapabilities();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const closeTab = useTableTabs((state) => state.closeTab);
  const { compile } = useCompileObject();
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [dropping, setDropping] = useState(false);
  const [copyTarget, setCopyTarget] = useState<{
    schema: string;
    name: string;
    objectType: SchemaCopyObjectType;
  } | null>(null);

  const handleCompile = (schema: string, name: string, part: PackagePart) =>
    void compile(
      packageOid(schema, name, part),
      part === "spec" ? "package_spec" : "package_body",
      `${schema}.${name}`,
    );

  const handleDrop = async () => {
    if (!dropTarget || !connection) return;
    const { schema, name, kind } = dropTarget;
    const label = `${schema}.${name}`;
    setDropping(true);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        `DROP PACKAGE ${kind === "body" ? "BODY " : ""}"${schema}"."${name}"`,
        database ?? undefined,
      );
      toast.success(kind === "body" ? `Body von ${label} gelöscht` : `${label} gelöscht`);
      if (kind === "package") closeTab(`package:${schema}.${name}`);
      await queryClient.invalidateQueries({ queryKey: ["functions"] });
      await queryClient.invalidateQueries({ queryKey: ["function-definition"] });
      await queryClient.invalidateQueries({ queryKey: ["invalid-objects"] });
      await queryClient.invalidateQueries({ queryKey: ["compile-errors"] });
    } catch (e) {
      toast.error(`${label} konnte nicht gelöscht werden`, { description: String(e) });
    } finally {
      setDropping(false);
      setDropTarget(null);
    }
  };

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
      {!filtered || filtered.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Keine Treffer.</p>
      ) : (
        <SidebarWindow count={filtered.length}>
          {(index) => {
            const item = filtered[index];
            return (
              <PackageNode
                key={`${item.schema}.${item.name}`}
                schema={item.schema}
                name={item.name}
                invalid={isPackageInvalid(invalidSet, item.schema, item.name)}
                canCopy={Boolean(capabilities.schema_object_copy)}
                canCompile={Boolean(capabilities.compile_objects)}
                onCopy={() =>
                  setCopyTarget({ schema: item.schema, name: item.name, objectType: "package" })
                }
                onCompile={(part) => handleCompile(item.schema, item.name, part)}
                onDrop={(kind) => setDropTarget({ schema: item.schema, name: item.name, kind })}
              />
            );
          }}
        </SidebarWindow>
      )}
      <CopyToSchemaDialog target={copyTarget} onClose={() => setCopyTarget(null)} />
      <AlertDialog open={dropTarget !== null} onOpenChange={(open) => !open && setDropTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dropTarget?.kind === "body"
                ? `Body von "${dropTarget.name}" löschen?`
                : `Package "${dropTarget?.name ?? ""}" löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dropTarget?.kind === "body"
                ? "Der Package Body wird unwiderruflich gelöscht (DROP PACKAGE BODY). Die Spec bleibt erhalten."
                : "Spec und Body werden unwiderruflich gelöscht (DROP PACKAGE). Abhängige Objekte werden INVALID."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dropping}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={handleDrop} disabled={dropping}>
              {dropping ? <Spinner className="size-4" /> : null}
              {dropTarget?.kind === "body" ? "Drop Body" : "Drop Package"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  BracesIcon,
  ChevronRightIcon,
  CopyIcon,
  HammerIcon,
  PackageIcon,
  SearchIcon,
  SquareTerminalIcon,
  TrashIcon,
} from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { useCompileObject } from "@/features/functions/use-compile-object";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { SidebarQueryError } from "@/features/sidebar/sidebar-query-error";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { buildInvalidSet, isPackageInvalid, isPackagePartInvalid } from "@/lib/invalid-objects";
import { type PackagePart, packageOid, parsePlsqlMembers } from "@/lib/plsql";
import { useFunctionDefinitionQuery, useInvalidObjectsQuery } from "@/lib/queries";
import { useSidebarSearch } from "@/lib/sidebar-search";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";

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

type DropKind = "package" | "body";

function PackageNode({ schema, name }: { schema: string; name: string }) {
  const go = usePackageNavigate(schema, name);
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const closeTab = useTableTabs((state) => state.closeTab);
  const capabilities = useActiveCapabilities();
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { compile } = useCompileObject();
  const [dropKind, setDropKind] = useState<DropKind | null>(null);
  const [dropping, setDropping] = useState(false);
  const { data: invalidObjects } = useInvalidObjectsQuery();
  const invalidSet = useMemo(() => buildInvalidSet(invalidObjects), [invalidObjects]);
  const invalid = isPackageInvalid(invalidSet, schema, name);
  const label = `${schema}.${name}`;

  const openInEditor = () => {
    const id = openQueryTabWithSql(`BEGIN\n  ${label}.;\nEND;`, label);
    void navigate({ to: "/query/$id", params: { id } });
  };

  const handleDrop = async () => {
    if (!dropKind || !connection) return;
    setDropping(true);
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        `DROP PACKAGE ${dropKind === "body" ? "BODY " : ""}"${schema}"."${name}"`,
        database ?? undefined,
      );
      toast.success(dropKind === "body" ? `Body von ${label} gelöscht` : `${label} gelöscht`);
      if (dropKind === "package") closeTab(`package:${schema}.${name}`);
      await queryClient.invalidateQueries({ queryKey: ["functions"] });
      await queryClient.invalidateQueries({ queryKey: ["function-definition"] });
      await queryClient.invalidateQueries({ queryKey: ["invalid-objects"] });
      await queryClient.invalidateQueries({ queryKey: ["compile-errors"] });
    } catch (e) {
      toast.error(`${label} konnte nicht gelöscht werden`, { description: String(e) });
    } finally {
      setDropping(false);
      setDropKind(null);
    }
  };

  return (
    <Collapsible asChild className="group/pkg">
      <SidebarMenuItem>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <SidebarMenuButton onClick={() => go()}>
              <CollapsibleTrigger asChild onClick={(e) => e.stopPropagation()}>
                <ChevronRightIcon className="transition-transform group-data-[state=open]/pkg:rotate-90" />
              </CollapsibleTrigger>
              <PackageIcon className="text-muted-foreground" />
              <span className="truncate">{name}</span>
              {invalid ? <InvalidMarker /> : null}
            </SidebarMenuButton>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => go("spec")}>Spec öffnen</ContextMenuItem>
            <ContextMenuItem onSelect={() => go("body")}>Body öffnen</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={openInEditor}>
              <SquareTerminalIcon />
              Aufruf im Editor
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(label)}>
              <CopyIcon />
              Namen kopieren
            </ContextMenuItem>
            {capabilities.compile_objects ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() =>
                    void compile(packageOid(schema, name, "spec"), "package_spec", label)
                  }
                >
                  <HammerIcon />
                  Spec kompilieren
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    void compile(packageOid(schema, name, "body"), "package_body", label)
                  }
                >
                  <HammerIcon />
                  Body kompilieren
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => setDropKind("body")}>
              <TrashIcon />
              Body löschen
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => setDropKind("package")}>
              <TrashIcon />
              Package löschen
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        <AlertDialog open={dropKind !== null} onOpenChange={(open) => !open && setDropKind(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {dropKind === "body" ? `Body von "${name}" löschen?` : `Package "${name}" löschen?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {dropKind === "body"
                  ? "Der Package Body wird unwiderruflich gelöscht (DROP PACKAGE BODY). Die Spec bleibt erhalten."
                  : "Spec und Body werden unwiderruflich gelöscht (DROP PACKAGE). Abhängige Objekte werden INVALID."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={dropping}>Abbrechen</AlertDialogCancel>
              <AlertDialogAction onClick={handleDrop} disabled={dropping}>
                {dropping ? <Spinner className="size-4" /> : null}
                {dropKind === "body" ? "Drop Body" : "Drop Package"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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

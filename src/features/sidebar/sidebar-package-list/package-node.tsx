import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CopyIcon,
  HammerIcon,
  PackageIcon,
  SquareTerminalIcon,
  TrashIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from "@/components/ui/sidebar";
import { Spinner } from "@/components/ui/spinner";
import { useCompileObject } from "@/features/functions/use-compile-object";
import { CopyToSchemaDialog } from "@/features/schema-copy/copy-to-schema-dialog";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, type SchemaCopyObjectType } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { buildInvalidSet, isPackageInvalid } from "@/lib/invalid-objects";
import { packageOid } from "@/lib/plsql";
import { useInvalidObjectsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { PartNode } from "./part-node";
import { usePackageNavigate } from "./use-package-navigate";

export type DropKind = "package" | "body";

export function PackageNode({ schema, name }: { schema: string; name: string }) {
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
  const [copyTarget, setCopyTarget] = useState<{
    schema: string;
    name: string;
    objectType: SchemaCopyObjectType;
  } | null>(null);
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
            {capabilities.schema_object_copy ? (
              <ContextMenuItem
                onSelect={() => setCopyTarget({ schema, name, objectType: "package" })}
              >
                <CopyIcon />
                In anderem Schema erstellen
              </ContextMenuItem>
            ) : null}
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
        <CopyToSchemaDialog target={copyTarget} onClose={() => setCopyTarget(null)} />
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

import { useNavigate } from "@tanstack/react-router";
import {
  ChevronRightIcon,
  CopyIcon,
  HammerIcon,
  PackageIcon,
  SquareTerminalIcon,
  TrashIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from "@/components/ui/sidebar";
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import type { PackagePart } from "@/lib/plsql";
import { useTableTabs } from "@/lib/table-tabs";
import { PartNode } from "./part-node";
import { usePackageNavigate } from "./use-package-navigate";

export type DropKind = "package" | "body";

interface PackageNodeProps {
  schema: string;
  name: string;
  invalid: boolean;
  canCopy: boolean;
  canCompile: boolean;
  onCopy: () => void;
  onCompile: (part: PackagePart) => void;
  onDrop: (kind: DropKind) => void;
}

export function PackageNode({
  schema,
  name,
  invalid,
  canCopy,
  canCompile,
  onCopy,
  onCompile,
  onDrop,
}: PackageNodeProps) {
  const go = usePackageNavigate(schema, name);
  const navigate = useNavigate();
  const openQueryTabWithSql = useTableTabs((state) => state.openQueryTabWithSql);
  const label = `${schema}.${name}`;

  const openInEditor = () => {
    const id = openQueryTabWithSql(`BEGIN\n  ${label}.;\nEND;`, label);
    void navigate({ to: "/query/$id", params: { id } });
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
            <CompareObjectMenuItem schema={schema} name={name} objectType="package" />
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={openInEditor}>
              <SquareTerminalIcon />
              Aufruf im Editor
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(label)}>
              <CopyIcon />
              Namen kopieren
            </ContextMenuItem>
            {canCopy ? (
              <ContextMenuItem onSelect={onCopy}>
                <CopyIcon />
                In anderem Schema erstellen
              </ContextMenuItem>
            ) : null}
            {canCompile ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => onCompile("spec")}>
                  <HammerIcon />
                  Spec kompilieren
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onCompile("body")}>
                  <HammerIcon />
                  Body kompilieren
                </ContextMenuItem>
              </>
            ) : null}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={() => onDrop("body")}>
              <TrashIcon />
              Body löschen
            </ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => onDrop("package")}>
              <TrashIcon />
              Package löschen
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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

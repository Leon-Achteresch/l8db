import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, PackageIcon } from "lucide-react";
import { useState } from "react";
import { CopyAsMenu } from "@/components/copy-as-menu";
import { ToolsMenu } from "@/components/tools-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SidebarMenuButton, SidebarMenuItem, SidebarMenuSub } from "@/components/ui/sidebar";
import { CompareObjectMenuItem } from "@/features/sidebar/compare-object-menu-item";
import { InvalidMarker } from "@/features/sidebar/invalid-marker";
import { copyNameActions } from "@/lib/clipboard";
import { formatMenuShortcut, MENU_KEYS, menuKeyHandler } from "@/lib/hotkeys";
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
  const [open, setOpen] = useState(false);
  const label = `${schema}.${name}`;

  const openInEditor = () => {
    const id = openQueryTabWithSql(`BEGIN\n  ${label}.;\nEND;`, label);
    void navigate({ to: "/query/$id", params: { id } });
  };

  return (
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger
          asChild
          onKeyDown={menuKeyHandler({
            newQuery: openInEditor,
            ...copyNameActions(name, label),
            drop: () => onDrop("package"),
          })}
        >
          <SidebarMenuButton onClick={() => go()}>
            <ChevronRightIcon
              aria-expanded={open}
              className={open ? "rotate-90 transition-transform" : "transition-transform"}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(!open);
              }}
            />
            <PackageIcon className="text-muted-foreground" />
            <span className="truncate">{name}</span>
            {invalid ? <InvalidMarker /> : null}
          </SidebarMenuButton>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => go()}>
            Öffnen
            <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.open)}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => go("spec")}>Spec öffnen</ContextMenuItem>
          <ContextMenuItem onSelect={() => go("body")}>Body öffnen</ContextMenuItem>
          <ContextMenuItem onSelect={openInEditor}>
            Neue Abfrage für {name}
            <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.newQuery)}</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <CopyAsMenu name={name} qualifiedName={label} shortcuts />
          <ContextMenuSeparator />
          {canCompile ? (
            <>
              <ContextMenuItem onSelect={() => onCompile("spec")}>Spec kompilieren</ContextMenuItem>
              <ContextMenuItem onSelect={() => onCompile("body")}>Body kompilieren</ContextMenuItem>
            </>
          ) : null}
          <ToolsMenu>
            <CompareObjectMenuItem schema={schema} name={name} objectType="package" />
            {canCopy ? (
              <ContextMenuItem onSelect={onCopy}>In anderem Schema erstellen…</ContextMenuItem>
            ) : null}
          </ToolsMenu>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => onDrop("body")}>
            Body löschen…
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => onDrop("package")}>
            Package löschen…
            <ContextMenuShortcut>{formatMenuShortcut(MENU_KEYS.drop)}</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {open ? (
        <SidebarMenuSub>
          <PartNode schema={schema} name={name} part="spec" title="Spec" />
          <PartNode schema={schema} name={name} part="body" title="Body" />
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

import { Bookmark, FileText, Folder, FolderOpen } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { EASE_OUT } from "@/features/ai/beui/lib/ease";
export type SidebarResourceKind = "folder" | "project" | "file" | "bookmark";
export interface SidebarResource {
  id: string;
  label: string;
  kind: SidebarResourceKind;
  children?: SidebarResource[];
  disabled?: boolean;
}
export type SidebarResourceDropPosition = "before" | "inside" | "after";
export interface SidebarResourceMove {
  itemId: string;
  targetId: string | null;
  position: SidebarResourceDropPosition;
}
export interface SidebarResourceMoveCommands {
  up?: () => void;
  down?: () => void;
  into?: {
    label: string;
    run: () => void;
  };
  out?: () => void;
}
export interface SidebarResourceMenuControls {
  close: () => void;
  rename: () => void;
  moves: SidebarResourceMoveCommands;
}
export interface AISidebarProps {
  items?: SidebarResource[];
  defaultItems?: SidebarResource[];
  onItemsChange?: (items: SidebarResource[]) => void;
  onMove?: (move: SidebarResourceMove) => void | Promise<void>;
  onMoveError?: (error: unknown, move: SidebarResourceMove) => void;
  onRename?: (item: SidebarResource, label: string) => void | Promise<void>;
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveChange?: (id: string) => void;
  defaultExpandedIds?: string[];
  renderIcon?: (item: SidebarResource) => ReactNode;
  renderMenu?: (item: SidebarResource, controls: SidebarResourceMenuControls) => ReactNode;
  ariaLabel?: string;
  className?: string;
}
export interface FlatResource {
  item: SidebarResource;
  depth: number;
  parentId: string | null;
}
export interface DropTarget {
  id: string | null;
  position: SidebarResourceDropPosition;
}
export const ROW_REVEAL = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;
export function canContain(item: SidebarResource) {
  return item.kind === "folder" || item.kind === "project";
}
export function flattenResources(
  items: SidebarResource[],
  expanded: Set<string>,
  depth = 0,
  parentId: string | null = null,
): FlatResource[] {
  return items.flatMap((item) => {
    const row = { item, depth, parentId };
    if (!item.children?.length || !expanded.has(item.id)) return [row];
    return [row, ...flattenResources(item.children, expanded, depth + 1, item.id)];
  });
}
export function findResource(items: SidebarResource[], id: string): SidebarResource | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findResource(item.children, id) : undefined;
    if (child) return child;
  }
}
export function containsResource(item: SidebarResource, id: string): boolean {
  return item.id === id || item.children?.some((child) => containsResource(child, id)) === true;
}
export function removeResource(
  items: SidebarResource[],
  id: string,
): {
  items: SidebarResource[];
  removed?: SidebarResource;
} {
  let removed: SidebarResource | undefined;
  const next: SidebarResource[] = [];
  for (const item of items) {
    if (item.id === id) {
      removed = item;
      continue;
    }
    if (item.children?.length) {
      const childResult = removeResource(item.children, id);
      if (childResult.removed) {
        removed = childResult.removed;
        next.push({ ...item, children: childResult.items });
        continue;
      }
    }
    next.push(item);
  }
  return { items: next, removed };
}
export function insertResource(
  items: SidebarResource[],
  resource: SidebarResource,
  targetId: string | null,
  position: SidebarResourceDropPosition,
): SidebarResource[] {
  if (targetId === null) return [...items, resource];
  const next: SidebarResource[] = [];
  for (const item of items) {
    if (item.id === targetId) {
      if (position === "before") next.push(resource, item);
      else if (position === "after") next.push(item, resource);
      else next.push({ ...item, children: [...(item.children ?? []), resource] });
      continue;
    }
    if (item.children?.length) {
      next.push({
        ...item,
        children: insertResource(item.children, resource, targetId, position),
      });
    } else {
      next.push(item);
    }
  }
  return next;
}
export function moveResource(
  items: SidebarResource[],
  move: SidebarResourceMove,
): SidebarResource[] | null {
  const source = findResource(items, move.itemId);
  if (!source || source.disabled) return null;
  if (move.targetId && containsResource(source, move.targetId)) return null;
  const target = move.targetId ? findResource(items, move.targetId) : undefined;
  if (move.position === "inside" && (!target || target.disabled || !canContain(target)))
    return null;
  const removed = removeResource(items, move.itemId);
  if (!removed.removed) return null;
  return insertResource(removed.items, removed.removed, move.targetId, move.position);
}
export function renameResource(
  items: SidebarResource[],
  id: string,
  label: string,
): SidebarResource[] {
  return items.map((item) => ({
    ...item,
    label: item.id === id ? label : item.label,
    children: item.children ? renameResource(item.children, id, label) : undefined,
  }));
}
export function defaultIcon(item: SidebarResource, expanded: boolean) {
  const Icon =
    item.kind === "folder" || item.kind === "project"
      ? expanded
        ? FolderOpen
        : Folder
      : item.kind === "bookmark"
        ? Bookmark
        : FileText;
  return <Icon className="size-4" />;
}
export interface ResourceRowProps {
  row: FlatResource;
  active: boolean;
  expanded: boolean;
  focused: boolean;
  draggingId: string | null;
  dropTarget: DropTarget | null;
  menuOpen: boolean;
  moves: SidebarResourceMoveCommands;
  renaming: boolean;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>, row: FlatResource) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, id: string) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onMenuOpenChange: (open: boolean) => void;
  onRenameCancel: () => void;
  onRenameCommit: (label: string) => void;
  onRenameStart: () => void;
  onSelect: () => void;
  onToggle: () => void;
  renderIcon?: (item: SidebarResource) => ReactNode;
  renderMenu?: AISidebarProps["renderMenu"];
  setRef: (node: HTMLDivElement | null) => void;
}

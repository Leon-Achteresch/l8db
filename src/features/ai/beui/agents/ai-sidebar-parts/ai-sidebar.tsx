import { AnimatePresence } from "motion/react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ResourceRow } from "./resource-row";
import {
  type AISidebarProps,
  canContain,
  containsResource,
  type DropTarget,
  type FlatResource,
  findResource,
  flattenResources,
  moveResource,
  renameResource,
  type SidebarResource,
  type SidebarResourceMove,
  type SidebarResourceMoveCommands,
} from "./shared";

export function AISidebar({
  items,
  defaultItems = [],
  onItemsChange,
  onMove,
  onMoveError,
  onRename,
  activeId,
  defaultActiveId = null,
  onActiveChange,
  defaultExpandedIds = [],
  renderIcon,
  renderMenu,
  ariaLabel = "Resources",
  className,
}: AISidebarProps) {
  const [internalItems, setInternalItems] = useState(items ?? defaultItems);
  const [internalActiveId, setInternalActiveId] = useState(defaultActiveId);
  const [expandedIds, setExpandedIds] = useState(() => new Set(defaultExpandedIds));
  const [focusedId, setFocusedId] = useState<string | null>(activeId ?? defaultActiveId);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const movePendingRef = useRef(false);
  const renderedItems = internalItems;
  const selectedId = activeId ?? internalActiveId;
  useEffect(() => {
    if (items) setInternalItems(items);
  }, [items]);
  const flat = useMemo(
    () => flattenResources(renderedItems, expandedIds),
    [expandedIds, renderedItems],
  );
  const focusedRow =
    focusedId !== null && flat.some((row) => row.item.id === focusedId)
      ? focusedId
      : (flat[0]?.item.id ?? null);
  if (focusedId !== focusedRow) setFocusedId(focusedRow);
  useEffect(() => {
    if (!menuOpenId) return;
    const frame = requestAnimationFrame(() => {
      const menus = Array.from(
        document.querySelectorAll<HTMLElement>("[data-sidebar-resource-menu]"),
      );
      menus
        .find((menu) => menu.dataset.sidebarResourceMenu === menuOpenId)
        ?.querySelector<HTMLElement>("button, a[href]")
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [menuOpenId]);
  const updateItems = useCallback(
    (next: SidebarResource[]) => {
      setInternalItems(next);
      onItemsChange?.(next);
    },
    [onItemsChange],
  );
  const performMove = useCallback(
    async (move: SidebarResourceMove) => {
      if (movePendingRef.current) {
        setAnnouncement("Wait for the current move to finish.");
        return;
      }
      const before = renderedItems;
      const next = moveResource(before, move);
      if (!next || next === before) return;
      movePendingRef.current = true;
      updateItems(next);
      setDropTarget(null);
      setDraggingId(null);
      const moved = findResource(before, move.itemId);
      const target = move.targetId ? findResource(before, move.targetId) : null;
      setAnnouncement(
        target
          ? `Moved ${moved?.label ?? "item"} ${move.position} ${target.label}.`
          : `Moved ${moved?.label ?? "item"} to the top level.`,
      );
      try {
        await onMove?.(move);
      } catch (error) {
        updateItems(before);
        setAnnouncement(`Move failed. ${moved?.label ?? "Item"} was restored.`);
        onMoveError?.(error, move);
      } finally {
        movePendingRef.current = false;
      }
    },
    [onMove, onMoveError, renderedItems, updateItems],
  );
  const focusRow = useCallback((id: string) => {
    setFocusedId(id);
    requestAnimationFrame(() => rowRefs.current.get(id)?.focus());
  }, []);
  const select = useCallback(
    (id: string) => {
      if (activeId === undefined) setInternalActiveId(id);
      onActiveChange?.(id);
    },
    [activeId, onActiveChange],
  );
  const toggle = useCallback((id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const moveCommands = useCallback(
    (row: FlatResource): SidebarResourceMoveCommands => {
      if (row.item.disabled) return {};
      const index = flat.findIndex(({ item }) => item.id === row.item.id);
      const previous = flat[index - 1];
      const next = flat[index + 1];
      const parentId = row.parentId;
      const commands: SidebarResourceMoveCommands = {};
      if (previous) {
        commands.up = () =>
          void performMove({
            itemId: row.item.id,
            targetId: previous.item.id,
            position: "before",
          });
      }
      if (next) {
        commands.down = () =>
          void performMove({
            itemId: row.item.id,
            targetId: next.item.id,
            position: "after",
          });
      }
      if (previous && canContain(previous.item) && previous.item.id !== parentId) {
        commands.into = {
          label: previous.item.label,
          run: () => {
            setExpandedIds((current) => new Set(current).add(previous.item.id));
            void performMove({
              itemId: row.item.id,
              targetId: previous.item.id,
              position: "inside",
            });
          },
        };
      }
      if (parentId) {
        commands.out = () =>
          void performMove({
            itemId: row.item.id,
            targetId: parentId,
            position: "after",
          });
      }
      return commands;
    },
    [flat, performMove],
  );
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, row: FlatResource) => {
      const index = flat.findIndex(({ item }) => item.id === row.item.id);
      const previous = flat[index - 1];
      const next = flat[index + 1];
      const moveModifier = event.altKey && event.shiftKey;
      if (event.key === "ArrowDown" && !moveModifier && next) {
        event.preventDefault();
        focusRow(next.item.id);
        return;
      }
      if (event.key === "ArrowUp" && !moveModifier && previous) {
        event.preventDefault();
        focusRow(previous.item.id);
        return;
      }
      if (event.key === "Home" && flat[0]) {
        event.preventDefault();
        focusRow(flat[0].item.id);
        return;
      }
      if (event.key === "End" && flat.at(-1)) {
        event.preventDefault();
        focusRow(flat.at(-1)?.item.id ?? row.item.id);
        return;
      }
      if (row.item.disabled) {
        if (event.key === "ArrowLeft" && row.parentId) {
          event.preventDefault();
          focusRow(row.parentId);
        } else if (
          moveModifier ||
          ["ArrowRight", "Enter", " ", "F2", "ContextMenu"].includes(event.key) ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
        }
        return;
      }
      if (moveModifier && event.key === "ArrowUp" && previous) {
        event.preventDefault();
        void performMove({ itemId: row.item.id, targetId: previous.item.id, position: "before" });
        return;
      }
      if (moveModifier && event.key === "ArrowDown" && next) {
        event.preventDefault();
        void performMove({ itemId: row.item.id, targetId: next.item.id, position: "after" });
        return;
      }
      if (moveModifier && event.key === "ArrowRight" && previous && canContain(previous.item)) {
        event.preventDefault();
        setExpandedIds((current) => new Set(current).add(previous.item.id));
        void performMove({ itemId: row.item.id, targetId: previous.item.id, position: "inside" });
        return;
      }
      if (moveModifier && event.key === "ArrowLeft" && row.parentId) {
        event.preventDefault();
        void performMove({ itemId: row.item.id, targetId: row.parentId, position: "after" });
        return;
      }
      if (event.key === "ArrowRight" && canContain(row.item)) {
        event.preventDefault();
        if (!expandedIds.has(row.item.id)) toggle(row.item.id);
        else if (next?.parentId === row.item.id) focusRow(next.item.id);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (expandedIds.has(row.item.id)) toggle(row.item.id);
        else if (row.parentId) focusRow(row.parentId);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (canContain(row.item)) toggle(row.item.id);
        else select(row.item.id);
      } else if (event.key === "F2") {
        event.preventDefault();
        setRenamingId(row.item.id);
      } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        setMenuOpenId(row.item.id);
      }
    },
    [expandedIds, flat, focusRow, performMove, select, toggle],
  );
  return (
    <>
      <div
        role="tree"
        aria-label={ariaLabel}
        aria-multiselectable="false"
        onDragOver={(event) => {
          if (!draggingId || event.target !== event.currentTarget) return;
          event.preventDefault();
          setDropTarget({ id: null, position: "after" });
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggingId && dropTarget) {
            void performMove({
              itemId: draggingId,
              targetId: dropTarget.id,
              position: dropTarget.position,
            });
          }
        }}
        className={cn(
          "relative flex min-w-0 flex-col gap-0.5 [overflow-anchor:none] group-data-[state=collapsed]/sidebar:hidden",
          draggingId && "select-none pb-9",
          className,
        )}
      >
        <AnimatePresence initial={false}>
          {flat.map((row) => (
            <ResourceRow
              key={row.item.id}
              row={row}
              active={selectedId === row.item.id}
              expanded={expandedIds.has(row.item.id)}
              focused={focusedRow === row.item.id}
              draggingId={draggingId}
              dropTarget={dropTarget}
              menuOpen={menuOpenId === row.item.id}
              moves={moveCommands(row)}
              renaming={renamingId === row.item.id}
              onFocus={() => setFocusedId(row.item.id)}
              onSelect={() => select(row.item.id)}
              onToggle={() => toggle(row.item.id)}
              onKeyDown={(event) => handleKeyDown(event, row)}
              onRenameStart={() => setRenamingId(row.item.id)}
              onRenameCancel={() => setRenamingId(null)}
              onRenameCommit={(label) => {
                const trimmed = label.trim();
                setRenamingId(null);
                if (!trimmed || trimmed === row.item.label) return;
                const before = renderedItems;
                updateItems(renameResource(before, row.item.id, trimmed));
                void Promise.resolve(onRename?.(row.item, trimmed)).catch(() => {
                  updateItems(before);
                  setAnnouncement(`Rename failed. ${row.item.label} was restored.`);
                });
              }}
              onMenuOpenChange={(open) => {
                setMenuOpenId(open ? row.item.id : null);
                if (!open) focusRow(row.item.id);
              }}
              onDragStart={(event, id) => {
                setDraggingId(id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTarget(null);
              }}
              onDragOver={(event, targetRow) => {
                if (!draggingId || draggingId === targetRow.item.id) return;
                const source = findResource(renderedItems, draggingId);
                if (source && containsResource(source, targetRow.item.id)) return;
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                const ratio = (event.clientY - rect.top) / rect.height;
                const position =
                  !targetRow.item.disabled &&
                  canContain(targetRow.item) &&
                  ratio >= 0.25 &&
                  ratio <= 0.75
                    ? "inside"
                    : ratio < 0.5
                      ? "before"
                      : "after";
                setDropTarget({ id: targetRow.item.id, position });
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (draggingId && dropTarget) {
                  void performMove({
                    itemId: draggingId,
                    targetId: dropTarget.id,
                    position: dropTarget.position,
                  });
                }
              }}
              renderIcon={renderIcon}
              renderMenu={renderMenu}
              setRef={(node) => {
                if (node) rowRefs.current.set(row.item.id, node);
                else rowRefs.current.delete(row.item.id);
              }}
            />
          ))}
        </AnimatePresence>

        {draggingId ? (
          <div
            aria-hidden="true"
            data-active={dropTarget?.id === null || undefined}
            className="absolute inset-x-1 bottom-0 flex h-8 items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground data-[active=true]:border-primary/50 data-[active=true]:bg-muted data-[active=true]:text-foreground"
          >
            Move to top level
          </div>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}

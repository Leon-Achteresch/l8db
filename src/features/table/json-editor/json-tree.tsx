import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useCallback, useEffect, useRef } from "react";
import { getAt, type JsonRow } from "@/lib/json-editor";
import { JSON_ROW_HEIGHT, JsonTreeRow } from "./json-tree-row";
import type { JsonEditorState } from "./use-json-editor";

type Props = {
  state: JsonEditorState;
  readOnly: boolean;
};

export function JsonTree({ state, readOnly }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { rows, selectedId, setSelectedId, actions, toggle, doc } = state;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => JSON_ROW_HEIGHT,
    getItemKey: (index) => rows[index].id,
    overscan: 12,
  });

  const selectedIndex = rows.findIndex((row) => row.id === selectedId);

  useEffect(() => {
    if (selectedIndex >= 0) virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
  }, [selectedIndex, virtualizer]);

  useEffect(() => {
    if (!state.editing) scrollRef.current?.focus({ preventScroll: true });
  }, [state.editing]);

  const selectRow = useCallback(
    (id: string) => {
      setSelectedId(id);
      scrollRef.current?.focus({ preventScroll: true });
    },
    [setSelectedId],
  );

  const { setEditing } = state;
  const cancelEdit = useCallback(() => setEditing(null), [setEditing]);

  const siblingKeysFor = (row: JsonRow) => {
    if (typeof row.key !== "string") return null;
    const parent = getAt(doc, row.path.slice(0, -1));
    return parent && typeof parent === "object" ? Object.keys(parent) : null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (state.editing || state.menuId) return;
    const row = rows[selectedIndex];
    if (!row) return;
    const mod = event.metaKey || event.ctrlKey;
    const go = (index: number) => {
      const target = rows[index];
      if (target && !target.closing) setSelectedId(target.id);
    };
    const step = (delta: number) => {
      let index = selectedIndex + delta;
      while (rows[index]?.closing) index += delta;
      go(index);
    };
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      handled();
      actions.move(row.path, event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "ArrowDown") {
      handled();
      step(1);
    } else if (event.key === "ArrowUp") {
      handled();
      step(-1);
    } else if (event.key === "Home") {
      handled();
      go(0);
    } else if (event.key === "End") {
      handled();
      go(rows.length - (rows.at(-1)?.closing ? 2 : 1));
    } else if (event.key === "ArrowRight") {
      handled();
      if (row.expandable && !row.expanded) toggle(row);
      else if (row.expanded) step(1);
    } else if (event.key === "ArrowLeft") {
      handled();
      if (row.expanded) toggle(row);
      else if (row.path.length) {
        const parentId = JSON.stringify(row.path.slice(0, -1));
        setSelectedId(parentId);
      }
    } else if (event.key === "Enter" && mod) {
      handled();
      if (row.expandable) actions.addChild(row.path);
      else actions.insertAfter(row.path);
    } else if (event.key === "Enter") {
      handled();
      if (row.expandable) toggle(row);
      else actions.startEdit(row.path, "value");
    } else if (event.key === " ") {
      handled();
      if (row.kind === "boolean" && !readOnly) actions.toggleBoolean(row.path);
      else if (row.expandable) toggle(row);
    } else if (event.key === "F2") {
      handled();
      actions.startEdit(row.path, "key");
    } else if ((event.key === "Backspace" || event.key === "Delete") && !readOnly) {
      handled();
      actions.remove(row.path);
    } else if (mod && event.key.toLowerCase() === "c") {
      handled();
      actions.copy(row.path, event.shiftKey ? "jsonpath" : "value");
    } else if (mod && event.key.toLowerCase() === "d") {
      handled();
      actions.duplicate(row.path);
    }
  };

  return (
    <div
      ref={scrollRef}
      role="tree"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="h-full overflow-auto py-1.5 font-mono text-xs outline-none"
      data-testid="json-tree"
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const editing =
            state.editing?.id === row.id && !row.closing ? state.editing.target : null;
          return (
            <div
              key={item.key}
              className="absolute inset-x-1.5 top-0"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <JsonTreeRow
                row={row}
                selected={row.id === selectedId}
                activeMatch={row.id === state.activeMatchId}
                isMatch={state.matchIds.has(row.id)}
                editing={editing}
                menuOpen={state.menuId === row.id}
                readOnly={readOnly}
                query={state.query}
                siblingKeys={editing === "key" ? siblingKeysFor(row) : null}
                actions={actions}
                onSelect={selectRow}
                onToggle={toggle}
                onMenuOpenChange={state.setMenuId}
                onCommitKey={state.commitKey}
                onCommitValue={state.commitValue}
                onCancelEdit={cancelEdit}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

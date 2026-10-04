import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { copyText } from "@/lib/clipboard";
import {
  ancestorIds,
  collectExpandable,
  computeStats,
  convertValue,
  findMatches,
  flattenRows,
  getAt,
  insertAfter,
  insertChild,
  type JsonKind,
  type JsonPath,
  type JsonRow,
  jsonKind,
  moveItem,
  parseEmbeddedJson,
  pathId,
  removeAt,
  renameKey,
  setAt,
  sortKeysDeep,
  stringifyJson,
  toJsAccessor,
  toJsonPath,
  toPostgresAccessor,
  toPostgresPath,
} from "@/lib/json-editor";
import type { JsonActions, JsonCopyFormat } from "./types";

const HISTORY_LIMIT = 200;
const TYPING_MERGE_MS = 800;

type Parsed = { ok: true; value: unknown } | { ok: false; error: string };

function parse(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type JsonEditorMode = "tree" | "code" | "table";

export function useJsonEditor({
  text,
  onChange,
  readOnly,
  columnName,
}: {
  text: string;
  onChange?: (text: string) => void;
  readOnly: boolean;
  columnName: string;
}) {
  const parsed = useMemo(() => parse(text), [text]);
  const lastValid = useRef<unknown>(parsed.ok ? parsed.value : null);
  if (parsed.ok) lastValid.current = parsed.value;
  const doc = lastValid.current;

  const [mode, setMode] = useState<JsonEditorMode>(parsed.ok ? "tree" : "code");
  const [expanded, setExpanded] = useState(() => collectExpandable(doc, 2));
  const [selectedId, setSelectedId] = useState<string>(pathId([]));
  const [editing, setEditing] = useState<{ id: string; target: "key" | "value" } | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const [history, setHistory] = useState({ stack: [text], index: 0 });
  const lastCommit = useRef({ at: 0, source: "" });

  const commit = useCallback(
    (next: string, source: "tree" | "code" = "tree") => {
      if (readOnly || !onChange || next === text) return;
      const now = Date.now();
      const merge =
        source === "code" &&
        lastCommit.current.source === "code" &&
        now - lastCommit.current.at < TYPING_MERGE_MS;
      lastCommit.current = { at: now, source };
      setHistory((prev) => {
        const base = prev.stack.slice(0, prev.index + 1);
        if (merge && base.length > 1) base[base.length - 1] = next;
        else base.push(next);
        const stack = base.slice(-HISTORY_LIMIT);
        return { stack, index: stack.length - 1 };
      });
      onChange(next);
    },
    [readOnly, onChange, text],
  );

  const reveal = useCallback((path: JsonPath) => {
    setSelectedId(pathId(path));
    setExpanded((prev) => {
      const out = new Set(prev);
      for (const id of ancestorIds([path])) out.add(id);
      return out;
    });
  }, []);

  const commitDoc = useCallback(
    (next: unknown, select?: JsonPath) => {
      commit(stringifyJson(next, 2));
      if (select) reveal(select);
    },
    [commit, reveal],
  );

  const canUndo = !readOnly && history.index > 0;
  const canRedo = !readOnly && history.index < history.stack.length - 1;
  const undo = useCallback(() => {
    if (!canUndo || !onChange) return;
    lastCommit.current = { at: 0, source: "" };
    setHistory((prev) => ({ ...prev, index: prev.index - 1 }));
    onChange(history.stack[history.index - 1]);
  }, [canUndo, onChange, history]);
  const redo = useCallback(() => {
    if (!canRedo || !onChange) return;
    lastCommit.current = { at: 0, source: "" };
    setHistory((prev) => ({ ...prev, index: prev.index + 1 }));
    onChange(history.stack[history.index + 1]);
  }, [canRedo, onChange, history]);

  const matches = useMemo(() => findMatches(doc, query), [doc, query]);
  const matchIds = useMemo(() => new Set(matches.map(pathId)), [matches]);
  const activeMatchId = matches.length ? pathId(matches[matchIndex % matches.length]) : null;
  const effectiveExpanded = useMemo(() => {
    if (!matches.length) return expanded;
    const out = new Set(expanded);
    for (const id of ancestorIds(matches)) out.add(id);
    return out;
  }, [expanded, matches]);
  const rows = useMemo(() => flattenRows(doc, effectiveExpanded), [doc, effectiveExpanded]);
  const stats = useMemo(() => computeStats(doc, text), [doc, text]);

  const selectedPath = useMemo<JsonPath>(() => {
    const path = JSON.parse(selectedId) as JsonPath;
    return getAt(doc, path) === undefined && path.length ? [] : path;
  }, [selectedId, doc]);

  const toggle = useCallback((row: JsonRow) => {
    setExpanded((prev) => {
      const out = new Set(prev);
      if (row.expanded) out.delete(row.id);
      else out.add(row.id);
      return out;
    });
    if (row.expanded) setQuery((current) => (current ? "" : current));
  }, []);

  const expandAll = useCallback(() => setExpanded(collectExpandable(doc)), [doc]);
  const collapseAll = useCallback(() => {
    setExpanded(new Set([pathId([])]));
    setQuery("");
  }, []);

  const stepMatch = useCallback(
    (delta: number) => {
      if (!matches.length) return;
      const next = (matchIndex + delta + matches.length) % matches.length;
      setMatchIndex(next);
      setSelectedId(pathId(matches[next]));
    },
    [matches, matchIndex],
  );

  const actions = useMemo<JsonActions>(() => {
    const edit = (fn: () => void) => {
      if (!readOnly) fn();
    };
    const copy = (path: JsonPath, format: JsonCopyFormat) => {
      const value = getAt(doc, path);
      const textFor: Record<JsonCopyFormat, () => string> = {
        value: () => (typeof value === "string" ? value : stringifyJson(value, 2)),
        key: () => String(path[path.length - 1] ?? ""),
        jsonpath: () => toJsonPath(path),
        js: () => toJsAccessor(path),
        pg: () =>
          toPostgresAccessor(
            path,
            columnName,
            jsonKind(value) !== "object" && jsonKind(value) !== "array",
          ),
        pgpath: () => `${toPostgresAccessor([], columnName)} #> ${toPostgresPath(path)}`,
      };
      const out = textFor[format]();
      void copyText(out);
      toast.success("Kopiert", { description: out.length > 80 ? `${out.slice(0, 80)}…` : out });
    };
    return {
      startEdit: (path, target) =>
        edit(() => {
          const kind = jsonKind(getAt(doc, path));
          if (target === "value" && (kind === "object" || kind === "array")) return;
          if (target === "key" && typeof path[path.length - 1] !== "string") return;
          setSelectedId(pathId(path));
          setEditing({ id: pathId(path), target });
        }),
      copy,
      setKind: (path, kind: JsonKind) =>
        edit(() => commitDoc(setAt(doc, path, convertValue(getAt(doc, path), kind)), path)),
      addChild: (path) =>
        edit(() => {
          const result = insertChild(doc, path, "");
          setExpanded((prev) => new Set(prev).add(pathId(path)));
          commitDoc(result.root, result.path);
          setEditing({
            id: pathId(result.path),
            target: Array.isArray(getAt(doc, path)) ? "value" : "key",
          });
        }),
      insertAfter: (path) =>
        edit(() => {
          const result = insertAfter(doc, path, "");
          commitDoc(result.root, result.path);
          setEditing({
            id: pathId(result.path),
            target: typeof result.path.at(-1) === "string" ? "key" : "value",
          });
        }),
      duplicate: (path) =>
        edit(() => {
          if (!path.length) return;
          const result = insertAfter(doc, path, structuredClone(getAt(doc, path)), true);
          commitDoc(result.root, result.path);
        }),
      remove: (path) =>
        edit(() => {
          if (!path.length) return;
          const index = rows.findIndex((row) => row.id === pathId(path) && !row.closing);
          const sibling = rows
            .slice(index + 1)
            .find((row) => !row.closing && row.depth <= path.length && row.depth > 0);
          const parent = path.slice(0, -1);
          const parentValue = getAt(doc, parent);
          let next: JsonPath = parent;
          if (sibling && sibling.depth === path.length) {
            const key = sibling.path[sibling.path.length - 1];
            next =
              Array.isArray(parentValue) && typeof key === "number"
                ? [...parent, key - 1]
                : sibling.path;
          }
          const root = removeAt(doc, path);
          commitDoc(root, getAt(root, next) === undefined ? parent : next);
        }),
      move: (path, delta) =>
        edit(() => {
          const result = moveItem(doc, path, delta);
          if (result) commitDoc(result.root, result.path);
        }),
      sortKeys: (path) =>
        edit(() => commitDoc(setAt(doc, path, sortKeysDeep(getAt(doc, path))), path)),
      unpack: (path) =>
        edit(() => {
          const value = getAt(doc, path);
          const inner = typeof value === "string" ? parseEmbeddedJson(value) : undefined;
          if (inner === undefined) return;
          setExpanded((prev) => new Set(prev).add(pathId(path)));
          commitDoc(setAt(doc, path, inner), path);
          toast.success("Eingebettetes JSON entpackt");
        }),
      pack: (path) =>
        edit(() => commitDoc(setAt(doc, path, JSON.stringify(getAt(doc, path))), path)),
      expandDeep: (path, open) =>
        setExpanded((prev) => {
          const out = new Set(prev);
          for (const id of collectExpandable(getAt(doc, path))) {
            const full = pathId([...path, ...(JSON.parse(id) as JsonPath)]);
            if (open) out.add(full);
            else out.delete(full);
          }
          return out;
        }),
      toggleBoolean: (path) => edit(() => commitDoc(setAt(doc, path, !getAt(doc, path)))),
      openUrl: (url) => void openUrl(url).catch((error) => toast.error(String(error))),
    };
  }, [doc, readOnly, commitDoc, columnName, rows]);

  const commitKey = useCallback(
    (row: JsonRow, key: string) => {
      setEditing(null);
      const path = [...row.path.slice(0, -1), key];
      if (row.expanded) setExpanded((prev) => new Set(prev).add(pathId(path)));
      commitDoc(renameKey(doc, row.path, key), path);
    },
    [doc, commitDoc],
  );

  const commitValue = useCallback(
    (row: JsonRow, value: unknown) => {
      setEditing(null);
      commitDoc(setAt(doc, row.path, value), row.path);
    },
    [doc, commitDoc],
  );

  return {
    parsed,
    doc,
    mode,
    setMode,
    rows,
    stats,
    selectedId,
    setSelectedId,
    selectedPath,
    reveal,
    editing,
    setEditing,
    menuId,
    setMenuId,
    query,
    setQuery: (next: string) => {
      setQuery(next);
      setMatchIndex(0);
    },
    matches,
    matchIds,
    matchIndex: matches.length ? matchIndex % matches.length : 0,
    activeMatchId,
    stepMatch,
    toggle,
    expandAll,
    collapseAll,
    commit,
    commitDoc,
    commitKey,
    commitValue,
    actions,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}

export type JsonEditorState = ReturnType<typeof useJsonEditor>;

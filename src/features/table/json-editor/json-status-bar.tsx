import { ChevronRightIcon, CircleCheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Fragment } from "react";
import { type JsonPath, jsonKind, pathId, toJsonPath } from "@/lib/json-editor";
import { formatByteSize } from "@/lib/value-viewers/binary";
import { JsonTypeIcon } from "./json-type-icon";
import type { JsonEditorState } from "./use-json-editor";

export function JsonStatusBar({ state }: { state: JsonEditorState }) {
  const { selectedPath, stats, parsed, doc } = state;
  const showPath = state.mode !== "code";
  const select = (path: JsonPath) => state.reveal(path);
  let cursor: unknown = doc;
  const crumbs = selectedPath.map((segment, index) => {
    cursor = (cursor as Record<string | number, unknown>)?.[segment];
    return { segment, path: selectedPath.slice(0, index + 1), kind: jsonKind(cursor) };
  });
  return (
    <div className="flex min-h-8 items-center gap-3 border-t border-border/70 px-3 py-1 text-[11px] text-muted-foreground">
      {parsed.ok ? (
        <span className="inline-flex shrink-0 items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <CircleCheckIcon className="size-3.5" />
          Gültig
        </span>
      ) : (
        <span
          className="inline-flex min-w-0 items-center gap-1 text-destructive"
          title={parsed.error}
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="truncate">{parsed.error}</span>
        </span>
      )}
      {showPath && parsed.ok && (
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden font-mono">
          <button
            type="button"
            onClick={() => select([])}
            className="shrink-0 rounded px-1 hover:bg-muted hover:text-foreground"
          >
            $
          </button>
          {crumbs.map((crumb) => (
            <Fragment key={pathId(crumb.path)}>
              <ChevronRightIcon className="size-3 shrink-0 opacity-50" />
              <button
                type="button"
                onClick={() => select(crumb.path)}
                className="inline-flex min-w-0 items-center gap-1 rounded px-1 hover:bg-muted hover:text-foreground"
              >
                <JsonTypeIcon kind={crumb.kind} className="size-3.5 [&_svg]:size-2.5" />
                <span className="truncate">
                  {typeof crumb.segment === "number" ? `[${crumb.segment}]` : crumb.segment}
                </span>
              </button>
            </Fragment>
          ))}
          {selectedPath.length > 0 && (
            <button
              type="button"
              onClick={() => state.actions.copy(selectedPath, "jsonpath")}
              className="ml-1 shrink-0 rounded p-0.5 hover:bg-muted hover:text-foreground"
              title={`${toJsonPath(selectedPath)} kopieren`}
            >
              <CopyIcon className="size-3" />
            </button>
          )}
        </div>
      )}
      {!showPath && <div className="flex-1" />}
      <span className="ml-auto shrink-0 tabular-nums">
        {stats.nodes.toLocaleString()} Knoten · Tiefe {stats.depth} · {formatByteSize(stats.bytes)}
      </span>
    </div>
  );
}

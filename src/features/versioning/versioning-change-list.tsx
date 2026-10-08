import { CheckCircle2Icon, FileCode2Icon } from "lucide-react";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { COMPARE_OBJECT_LABELS } from "@/lib/compare-types";
import { cn } from "@/lib/utils";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";

export function VersioningChangeList({
  workspace,
  development,
  onOpen,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  onOpen?: () => void;
}) {
  const { project, status, run } = workspace;
  const { changes, showAll, path, selected, setSelected, load } = development;
  if (!project || !status) return null;
  const files = status.files.filter((file) => showAll || changes.has(file));
  return (
    <ul className="flex flex-col" aria-label={showAll ? "Alle Dateien" : "Geänderte Objekte"}>
      {files.map((file) => {
        const object = project.objects.find((item) => item.path === file || item.bodyPath === file);
        const change = changes.get(file);
        const added = Boolean(change && (change.includes("?") || change.includes("A")));
        const removed = Boolean(change?.includes("D"));
        const letter = added ? "A" : removed ? "D" : change?.includes("U") ? "U" : "M";
        const name = object?.selection.objectName ?? file.split("/").at(-1);
        const part = file.endsWith(".pks") ? " · Spec" : file.endsWith(".pkb") ? " · Body" : "";
        const kind = object
          ? COMPARE_OBJECT_LABELS[object.selection.objectType]
          : file.split("/").slice(0, -1).join("/");
        return (
          <li
            key={file}
            className={cn(
              "group flex h-7 items-center gap-2 rounded-md pr-2 pl-1 transition-colors hover:bg-muted/50",
              path === file && "bg-muted",
            )}
          >
            <input
              type="checkbox"
              aria-label={`Commit: ${file}`}
              disabled={!change}
              checked={selected.includes(file)}
              onChange={(event) =>
                setSelected((items) =>
                  event.target.checked ? [...items, file] : items.filter((item) => item !== file),
                )
              }
              className={cn(
                "size-3.5 shrink-0",
                !change && "invisible",
                change && selected.includes(file) && "opacity-60 group-hover:opacity-100",
              )}
            />
            <button
              type="button"
              title={file}
              aria-label={`${name}${part} ${object?.selection.schema ?? file.split("/").slice(0, -1).join("/")}`}
              onClick={() =>
                void run(async () => {
                  await load(file);
                  onOpen?.();
                })
              }
              className="flex h-full min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none"
            >
              {object ? (
                <CompareObjectIcon type={object.selection.objectType} className="size-3.5" />
              ) : (
                <FileCode2Icon className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span
                className={cn(
                  "min-w-0 truncate font-mono text-xs",
                  removed && "text-muted-foreground line-through",
                )}
              >
                {name}
                {part}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {kind}
              </span>
              {change && (
                <span
                  role="img"
                  title={
                    added ? "Neu" : removed ? "Entfernt" : letter === "U" ? "Konflikt" : "Geändert"
                  }
                  aria-label={
                    added ? "Neu" : removed ? "Entfernt" : letter === "U" ? "Konflikt" : "Geändert"
                  }
                  className={cn(
                    "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
                    added
                      ? "text-emerald-600 dark:text-emerald-400"
                      : removed || letter === "U"
                        ? "text-destructive"
                        : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {letter}
                </span>
              )}
            </button>
          </li>
        );
      })}
      {!files.length && (
        <li className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
          <CheckCircle2Icon className="size-3.5 shrink-0" />
          {status.files.length ? "Alles committet" : "Noch keine Definitionen im Repository"}
        </li>
      )}
    </ul>
  );
}

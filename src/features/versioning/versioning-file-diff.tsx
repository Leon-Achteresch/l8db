import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  GitMergeIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type DefinitionDiffApi,
  DefinitionDiffEditor,
  type DiffStats,
} from "@/features/compare/definition-diff-editor";
import { cn } from "@/lib/utils";
import { hasMergeMarkers } from "@/lib/versioning/conflicts";
import type { DevelopmentState } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningConflicts } from "./versioning-conflicts";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPopover } from "./versioning-popover";
import { VersioningSelect } from "./versioning-select";

export function VersioningFileDiff({
  workspace,
  development,
  fill = false,
}: {
  workspace: VersioningWorkspace;
  development: DevelopmentState;
  fill?: boolean;
}) {
  const editor = useRef<DefinitionDiffApi>(null);
  const [stats, setStats] = useState<DiffStats | null>(null);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const { project, status, run } = workspace;
  const {
    path,
    original,
    draft,
    setDraft,
    unsaved,
    changes,
    mergedFrom,
    mergeSource,
    setMergeBranch,
    mergeBranches,
  } = development;
  if (!path || !project) return null;
  const object = project.objects.find((item) => item.path === path || item.bodyPath === path);
  const change = changes.get(path);
  const letter = !change
    ? null
    : change.includes("?") || change.includes("A")
      ? "A"
      : change.includes("D")
        ? "D"
        : "M";
  const name = object
    ? [object.selection.schema, object.selection.objectName].filter(Boolean).join(".")
    : path.split("/").at(-1);
  const conflicted = hasMergeMarkers(draft);
  return (
    <div className={cn("flex min-w-0 flex-col", fill ? "min-h-0 flex-1" : "gap-2")}>
      <div
        className={cn(
          "flex min-w-0 shrink-0 items-center gap-2",
          fill && "h-11 border-b border-border/60 px-3",
        )}
      >
        <span title={path} className="min-w-0 truncate font-mono text-xs font-medium">
          {name}
          {path.endsWith(".pks") ? " · Spec" : path.endsWith(".pkb") ? " · Body" : ""}
        </span>
        {letter && (
          <span
            className={cn(
              "shrink-0 font-mono text-[11px] font-semibold",
              letter === "A"
                ? "text-emerald-600 dark:text-emerald-400"
                : letter === "D"
                  ? "text-destructive"
                  : "text-amber-600 dark:text-amber-400",
            )}
          >
            {letter}
          </span>
        )}
        {unsaved && (
          <span
            className="size-1.5 shrink-0 rounded-full bg-amber-500"
            role="img"
            aria-label="Ungespeichert"
            title="Ungespeichert"
          />
        )}
        {fill && (
          <span className="hidden min-w-0 truncate border-l border-border/60 pl-2 text-[11px] text-muted-foreground 2xl:inline">
            {status?.branch ?? "HEAD"}{" "}
            <span className="font-mono">{status?.head?.slice(0, 7) ?? ""}</span> → Arbeitskopie
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {stats && (
            <span className="mr-1 text-[11px] text-muted-foreground tabular-nums">
              {stats.changes} {stats.changes === 1 ? "Änderung" : "Änderungen"}
            </span>
          )}
          <VersioningIconButton
            icon={ArrowUpIcon}
            label="Vorherige Änderung"
            disabled={!stats?.changes}
            className="size-7"
            onClick={() => editor.current?.goToChange(-1)}
          />
          <VersioningIconButton
            icon={ArrowDownIcon}
            label="Nächste Änderung"
            disabled={!stats?.changes}
            className="size-7"
            onClick={() => editor.current?.goToChange(1)}
          />
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={onlyDifferences ? "changes" : "all"}
            onValueChange={(value) => value && setOnlyDifferences(value === "changes")}
            aria-label="Diff-Umfang"
            className="mx-1"
          >
            <ToggleGroupItem value="all" className="h-7 px-2 text-[11px]">
              Ganze Datei
            </ToggleGroupItem>
            <ToggleGroupItem value="changes" className="h-7 px-2 text-[11px]">
              Nur Änderungen
            </ToggleGroupItem>
          </ToggleGroup>
          <VersioningPopover
            icon={GitMergeIcon}
            label="Aus Branch zusammenführen"
            disabled={
              workspace.busy || !mergeBranches.length || path.startsWith("database/releases/")
            }
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              Übernimmt Änderungen an dieser Datei aus einem anderen Branch. Andere Dateien bleiben
              unberührt.
            </p>
            <VersioningSelect
              label="Quell-Branch"
              value={mergeSource}
              onChange={setMergeBranch}
              options={mergeBranches.map((branch) => ({ value: branch, label: branch }))}
            />
            <Button
              size="sm"
              disabled={!mergeSource || conflicted}
              onClick={() => void run(development.merge)}
            >
              Datei zusammenführen
            </Button>
          </VersioningPopover>
          <VersioningIconButton
            icon={Undo2Icon}
            label="Entwurf verwerfen"
            disabled={!unsaved}
            onClick={development.discard}
          />
          {unsaved ? (
            <Button
              size="sm"
              className="ml-1 h-7"
              disabled={conflicted}
              onClick={() => void development.save()}
            >
              <CheckIcon className="size-3.5" />
              Speichern
            </Button>
          ) : (
            <VersioningIconButton icon={CheckIcon} label="Entwurf speichern" disabled />
          )}
          {fill && (
            <VersioningIconButton
              icon={XIcon}
              label="Datei schließen"
              onClick={() => void run(async () => development.close())}
            />
          )}
        </div>
      </div>
      {mergedFrom && unsaved && (
        <p className={cn("text-[11px] text-muted-foreground", fill && "px-3 pt-2")}>
          Entwurf mit {mergedFrom} zusammengeführt. Prüfe die Definition vor dem Commit.
        </p>
      )}
      <div className={cn(fill && "px-3 pt-2 empty:hidden")}>
        <VersioningConflicts content={draft} onChange={setDraft} />
      </div>
      <div
        className={cn(
          "min-w-0 overflow-hidden",
          fill ? "min-h-0 flex-1" : "h-[360px] rounded-lg bg-muted/20",
        )}
      >
        <DefinitionDiffEditor
          ref={editor}
          original={original}
          modified={draft}
          onlyDifferences={onlyDifferences}
          onStats={setStats}
          onModifiedChange={setDraft}
        />
      </div>
    </div>
  );
}

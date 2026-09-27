import {
  CheckCircle2Icon,
  CheckIcon,
  FileCode2Icon,
  GitCommitHorizontalIcon,
  GitMergeIcon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DefinitionDiffEditor } from "@/features/compare/definition-diff-editor";
import { versioningRepository } from "@/lib/db";
import { cn } from "@/lib/utils";
import { hasMergeMarkers } from "@/lib/versioning/conflicts";
import { readFile, saveFile } from "@/lib/versioning/repository";
import { changedFiles } from "@/lib/versioning/status";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningConflicts } from "./versioning-conflicts";
import { VersioningDatabaseChanges } from "./versioning-database-changes";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPopover } from "./versioning-popover";
import { VersioningSelect } from "./versioning-select";

export function VersioningDevelopment({ workspace }: { workspace: VersioningWorkspace }) {
  const { repo, project, status, run, refresh } = workspace;
  const [showAll, setShowAll] = useState(false);
  const [path, setPath] = useState("");
  const [original, setOriginal] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [mergeBranch, setMergeBranch] = useState("");
  const [mergedFrom, setMergedFrom] = useState<string | null>(null);
  useEffect(() => {
    workspace.setDirty(Boolean(path) && draft !== (saved ?? ""));
  }, [draft, saved, path, workspace.setDirty]);
  const load = async (file: string) => {
    if (path && draft !== (saved ?? ""))
      throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    const diff = await versioningRepository<{ original: string; modified: string }>({
      action: "diff",
      repo,
      path: file,
    });
    const current = await readFile(repo, file);
    if (diff.modified !== (current ?? ""))
      throw new Error("Datei wurde während des Lesens geändert. Bitte erneut öffnen.");
    setPath(file);
    setOriginal(diff.original);
    setDraft(diff.modified);
    setSaved(current);
    setMergedFrom(null);
  };
  const merge = async () => {
    if (!path || !mergeSource) throw new Error("Datei und Quell-Branch auswählen.");
    if (hasMergeMarkers(draft))
      throw new Error("Vor einem weiteren Merge zuerst vorhandene Konflikte auflösen.");
    if (path.startsWith("database/releases/"))
      throw new Error("Commitete Releases sind unveränderlich. Bitte einen neuen Release anlegen.");
    const revisions = await versioningRepository<{
      head: string;
      base: string;
      incoming: string;
    }>({ action: "merge-base", repo, name: mergeSource, path });
    if (revisions.head !== status?.head)
      throw new Error("Der aktuelle Branch hat sich geändert. Bitte Versionierung aktualisieren.");
    const [ancestor, product] = await Promise.all([
      readFile(repo, path, revisions.base),
      readFile(repo, path, revisions.incoming),
    ]);
    if (ancestor === null || product === null)
      throw new Error(
        "Die Datei muss in beiden Branches und ihrer gemeinsamen Basis vorhanden sein.",
      );
    const result = await versioningRepository<{ content: string; conflicts: boolean }>({
      action: "merge",
      repo,
      content: draft,
      base: ancestor,
      incoming: product,
    });
    if (result.content === draft) {
      setMergedFrom(null);
      workspace.setMessage("Für diese Datei gibt es keine neuen Änderungen aus dem Quell-Branch.");
      return;
    }
    setDraft(result.content);
    setMergedFrom(`${mergeSource} · ${revisions.incoming.slice(0, 8)}`);
    workspace.setMessage(
      result.conflicts
        ? "Merge-Konflikte unten auflösen. Es wurde nichts gespeichert."
        : "Branch-Änderungen im Entwurf zusammengeführt. Bitte prüfen und speichern.",
    );
  };
  if (!project || !status) return null;
  const mergeBranches = status.branches.filter((branch) => branch !== status.branch);
  const mergeSource = mergeBranches.includes(mergeBranch) ? mergeBranch : (mergeBranches[0] ?? "");
  const changes = changedFiles(status.changes);
  const files = status.files.filter((file) => showAll || changes.has(file));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <VersioningDatabaseChanges workspace={workspace} />
      <div className="flex items-center gap-2 border-t border-border/50 pt-4">
        <div className="flex-1">
          <h2 className="text-xs font-semibold">Repository</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {changes.size} offen · {status.files.length} Dateien
          </p>
        </div>
        <VersioningPopover
          icon={GitCommitHorizontalIcon}
          label={`Änderungen committen${selected.length ? ` (${selected.length})` : ""}`}
          disabled={workspace.busy || !selected.length}
        >
          <p className="text-xs text-muted-foreground">{selected.length} ausgewählte Dateien</p>
          <Input
            aria-label="Commit-Nachricht"
            placeholder="Was hat sich geändert?"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          <Button
            size="sm"
            disabled={!selected.length || !message.trim() || workspace.dirty}
            onClick={() =>
              void run(async () => {
                await workspace.git("commit", message, selected);
                setSelected([]);
                setMessage("");
                if (path) await load(path);
              }, "Ausgewählte Dateien committet")
            }
          >
            <CheckIcon className="size-3.5" />
            Commit erstellen
          </Button>
        </VersioningPopover>
      </div>
      <div className="flex items-center gap-1 text-[11px]">
        <button
          type="button"
          aria-pressed={!showAll}
          onClick={() => setShowAll(false)}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            !showAll ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Offen <span className="ml-1 tabular-nums opacity-60">{changes.size}</span>
        </button>
        <button
          type="button"
          aria-pressed={showAll}
          onClick={() => setShowAll(true)}
          className={cn(
            "rounded-md px-2 py-1 transition-colors",
            showAll ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Alle Dateien
        </button>
        <label className="ml-auto flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Alle offenen Dateien auswählen"
            className="size-3.5"
            disabled={!changes.size}
            checked={Boolean(changes.size) && selected.length === changes.size}
            onChange={(event) => setSelected(event.target.checked ? [...changes.keys()] : [])}
          />
          Alle für Commit
        </label>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {files.map((file) => {
          const object = project.objects.find(
            (item) => item.path === file || item.bodyPath === file,
          );
          const change = changes.get(file);
          const label = object?.selection.objectName ?? file.split("/").at(-1);
          return (
            <div
              key={file}
              className={cn(
                "group flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/40",
                path === file && "bg-muted/50",
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
                className="size-3.5 shrink-0"
              />
              <button
                type="button"
                onClick={() => void run(() => load(file))}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
              >
                <FileCode2Icon className="size-4 shrink-0 text-muted-foreground/60" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">
                    {label}
                    {file.endsWith(".pks")
                      ? " · Specification"
                      : file.endsWith(".pkb")
                        ? " · Body"
                        : ""}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">
                    {object?.selection.schema ?? file.split("/").slice(0, -1).join("/")}
                  </span>
                </span>
                {change && (
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      change.includes("?") || change.includes("A")
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {change.includes("?") || change.includes("A")
                      ? "Neu"
                      : change.includes("D")
                        ? "Entfernt"
                        : "Geändert"}
                  </span>
                )}
              </button>
            </div>
          );
        })}
        {!files.length && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <CheckCircle2Icon className="mb-1 size-6 text-muted-foreground/40" strokeWidth={1.4} />
            <p className="text-xs font-medium">
              {status.files.length ? "Alles auf aktuellem Stand" : "Noch keine Definitionen"}
            </p>
            <p className="max-w-64 text-[11px] leading-relaxed text-muted-foreground">
              {status.files.length
                ? "Neue Änderungen erscheinen hier automatisch."
                : "Entwicklungsdatenbank verknüpfen und vergleichen, um das Schema aufzunehmen."}
            </p>
          </div>
        )}
      </div>
      {path && (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center gap-1">
            <span title={path} className="min-w-0 flex-1 truncate font-mono text-[11px]">
              {path.split("/").at(-1)}
            </span>
            {draft !== (saved ?? "") && (
              <span
                className="mr-1 size-1.5 rounded-full bg-amber-500"
                role="img"
                aria-label="Ungespeichert"
              />
            )}
            <VersioningPopover
              icon={GitMergeIcon}
              label="Aus Branch zusammenführen"
              disabled={
                workspace.busy || !mergeBranches.length || path.startsWith("database/releases/")
              }
            >
              <p className="text-xs leading-relaxed text-muted-foreground">
                Änderungen an dieser Datei aus einem anderen Branch übernehmen. Die gemeinsame Basis
                wird automatisch gefunden. Andere Dateien bleiben unberührt.
              </p>
              <VersioningSelect
                label="Quell-Branch"
                value={mergeSource}
                onChange={setMergeBranch}
                options={mergeBranches.map((branch) => ({ value: branch, label: branch }))}
              />
              <Button
                size="sm"
                disabled={!mergeSource || hasMergeMarkers(draft)}
                onClick={() => void run(merge)}
              >
                Datei zusammenführen
              </Button>
            </VersioningPopover>
            <VersioningIconButton
              icon={Undo2Icon}
              label="Entwurf verwerfen"
              disabled={draft === (saved ?? "")}
              onClick={() => {
                setDraft(saved ?? "");
                setMergedFrom(null);
              }}
            />
            <VersioningIconButton
              icon={CheckIcon}
              label="Entwurf speichern"
              disabled={draft === (saved ?? "") || hasMergeMarkers(draft)}
              onClick={() =>
                void run(async () => {
                  await saveFile(repo, path, draft, saved);
                  setSaved(draft);
                  setMergedFrom(null);
                  workspace.setDirty(false);
                  await refresh();
                }, "Entwurf gespeichert")
              }
            />
          </div>
          {mergedFrom && draft !== (saved ?? "") && (
            <p className="text-[11px] text-muted-foreground">
              Entwurf mit {mergedFrom} zusammengeführt. Prüfe die Definition vor dem Commit.
            </p>
          )}
          <VersioningConflicts content={draft} onChange={setDraft} />
          <div className="h-[360px] min-w-0 overflow-hidden rounded-lg bg-muted/20">
            <DefinitionDiffEditor
              original={original}
              modified={draft}
              onlyDifferences={false}
              onModifiedChange={setDraft}
            />
          </div>
        </div>
      )}
    </div>
  );
}

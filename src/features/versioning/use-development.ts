import { useEffect, useRef, useState } from "react";
import { versioningRepository } from "@/lib/db";
import { hasMergeMarkers } from "@/lib/versioning/conflicts";
import { readFile, saveFile } from "@/lib/versioning/repository";
import { changedFiles } from "@/lib/versioning/status";
import type { VersioningWorkspace } from "./use-versioning";

export function useDevelopment(workspace: VersioningWorkspace) {
  const { repo, status, run, refresh } = workspace;
  const [showAll, setShowAll] = useState(false);
  const [path, setPath] = useState("");
  const [original, setOriginal] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string[]>(() => [
    ...changedFiles(status?.changes ?? "").keys(),
  ]);
  const known = useRef(new Set(selected));
  useEffect(() => {
    const current = changedFiles(status?.changes ?? "");
    setSelected((items) => [
      ...new Set([
        ...items.filter((item) => current.has(item)),
        ...[...current.keys()].filter((item) => !known.current.has(item)),
      ]),
    ]);
    known.current = new Set(current.keys());
  }, [status?.changes]);
  const [message, setMessage] = useState("");
  const [mergeBranch, setMergeBranch] = useState("");
  const [mergedFrom, setMergedFrom] = useState<string | null>(null);
  const unsaved = Boolean(path) && draft !== (saved ?? "");
  useEffect(() => {
    workspace.setDirty(unsaved);
  }, [unsaved, workspace.setDirty]);
  const load = async (file: string) => {
    if (unsaved) throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
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
  const close = () => {
    if (unsaved) throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    setPath("");
    setOriginal("");
    setDraft("");
    setSaved(null);
    setMergedFrom(null);
  };
  const mergeBranches = status?.branches.filter((branch) => branch !== status.branch) ?? [];
  const mergeSource = mergeBranches.includes(mergeBranch) ? mergeBranch : (mergeBranches[0] ?? "");
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
  const discard = () => {
    setDraft(saved ?? "");
    setMergedFrom(null);
  };
  const save = () =>
    run(async () => {
      await saveFile(repo, path, draft, saved);
      setSaved(draft);
      setMergedFrom(null);
      workspace.setDirty(false);
      await refresh();
    }, "Entwurf gespeichert");
  const changes = changedFiles(status?.changes ?? "");
  const commit = async (push = false, extra: string[] = [], exclude: string[] = []) => {
    const paths = [...new Set([...selected, ...extra])].filter(
      (file) => extra.includes(file) || !exclude.includes(file),
    );
    await workspace.git("commit", message, paths);
    setSelected([]);
    setMessage("");
    if (push) {
      await versioningRepository({ action: "push", repo });
      await refresh();
    }
    if (path) await load(path);
  };
  return {
    showAll,
    setShowAll,
    path,
    original,
    saved,
    draft,
    setDraft,
    unsaved,
    selected,
    setSelected,
    message,
    setMessage,
    mergeSource,
    setMergeBranch,
    mergeBranches,
    mergedFrom,
    changes,
    load,
    close,
    merge,
    discard,
    save,
    commit,
  };
}

export type DevelopmentState = ReturnType<typeof useDevelopment>;

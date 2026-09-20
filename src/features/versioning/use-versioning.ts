import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { versioningRepository } from "@/lib/db";
import { loadReleases, loadRepository, readTargets } from "@/lib/versioning/repository";
import type {
  DatabaseRelease,
  RepositoryStatus,
  TargetStore,
  VersioningProject,
} from "@/lib/versioning/types";

export function useVersioning() {
  const [repo, setRepo] = useState(() => localStorage.getItem("l8db.versioning.repo") ?? "");
  const [status, setStatus] = useState<RepositoryStatus | null>(null);
  const [project, setProject] = useState<VersioningProject | null>(null);
  const [projectText, setProjectText] = useState<string | null>(null);
  const [releases, setReleases] = useState<DatabaseRelease[]>([]);
  const [targets, setTargets] = useState<TargetStore | null>(null);
  const [dirty, updateDirty] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    updateDirty(value);
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const refresh = useCallback(
    async (path = repo) => {
      if (dirtyRef.current)
        throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
      const loaded = await loadRepository(path);
      const nextReleases = loaded.project
        ? await loadReleases(loaded.status.repo, loaded.project)
        : [];
      const nextTargets = loaded.project
        ? (await readTargets(loaded.status.repo, loaded.project.id)).store
        : null;
      setRepo(loaded.status.repo);
      localStorage.setItem("l8db.versioning.repo", loaded.status.repo);
      setStatus(loaded.status);
      setProject(loaded.project);
      setProjectText(loaded.projectText);
      setReleases(nextReleases);
      setTargets(nextTargets);
    },
    [repo],
  );
  const run = async (action: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (success) {
        setMessage(success);
        toast.success(success);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  const git = async (action: "branch" | "checkout" | "commit", name: string, paths?: string[]) => {
    if (dirty) throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
    await versioningRepository({ action, repo, name, paths });
    await refresh();
  };
  return {
    repo,
    dirty,
    setDirty,
    setRepo,
    status,
    project,
    projectText,
    releases,
    targets,
    busy,
    error,
    message,
    setMessage,
    refresh,
    run,
    git,
  };
}

export type VersioningWorkspace = ReturnType<typeof useVersioning>;

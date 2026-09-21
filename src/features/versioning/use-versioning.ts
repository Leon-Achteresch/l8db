import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { versioningRepository } from "@/lib/db";
import { useVersioningPanel } from "@/lib/versioning/panel";
import { loadReleases, loadRepository, readTargets } from "@/lib/versioning/repository";
import { pendingVersioningCount } from "@/lib/versioning/status";
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
  const [statusError, setStatusError] = useState<string | null>(null);
  const refreshRevision = useRef(0);
  const [message, setMessage] = useState("");
  const refresh = useCallback(
    async (path = repo) => {
      if (dirtyRef.current)
        throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
      const request = ++refreshRevision.current;
      const loaded = await loadRepository(path);
      const nextReleases = loaded.project
        ? await loadReleases(loaded.status.repo, loaded.project)
        : [];
      const nextTargets = loaded.project
        ? (await readTargets(loaded.status.repo, loaded.project.id)).store
        : null;
      if (request !== refreshRevision.current || dirtyRef.current) return;
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
  useEffect(() => {
    if (!repo || busy || dirty) return;
    let active = true;
    let loading = false;
    const check = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        await refresh();
        if (active) setStatusError(null);
      } catch (cause) {
        if (active) setStatusError(String(cause));
      } finally {
        loading = false;
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 15000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [repo, busy, dirty, refresh]);
  useEffect(() => {
    useVersioningPanel
      .getState()
      .setAttention(
        pendingVersioningCount(status, releases, targets, dirty),
        Boolean(error || statusError),
      );
  }, [status, releases, targets, dirty, error, statusError]);
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
    error: error ?? statusError,
    message,
    setMessage,
    refresh,
    run,
    git,
  };
}

export type VersioningWorkspace = ReturnType<typeof useVersioning>;

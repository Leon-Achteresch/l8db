import { useCallback, useEffect, useRef, useState } from "react";
import { type CompareSideSelection, EMPTY_COMPARE_SIDE } from "@/lib/compare-types";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { type DriftEntry, saveDrift, scanDrift } from "@/lib/versioning/drift";
import type { VersioningWorkspace } from "./use-versioning";

const sourceKey = (projectId: string, branch: string | null | undefined) =>
  `l8db.versioning.source.${projectId}.${branch ?? "HEAD"}`;

function initialSource(
  workspace: VersioningWorkspace,
  activeId: string | null,
  activeKind: string | null,
): CompareSideSelection {
  const { project, targets, status, branchTargetId } = workspace;
  const target = targets?.targets.find((entry) => entry.id === branchTargetId && !entry.production);
  if (target)
    return {
      ...EMPTY_COMPARE_SIDE,
      connectionId: target.connectionId,
      database: target.database,
      schema: target.schema ?? null,
    };
  const shared = targets?.branches?.[status?.branch ?? ""]?.source;
  if (shared)
    return {
      ...EMPTY_COMPARE_SIDE,
      connectionId: targets?.connectionBindings?.[shared.connectionRef] ?? null,
      database: shared.database,
      schema: shared.schema,
    };
  const stored =
    project &&
    (localStorage.getItem(sourceKey(project.id, status?.branch)) ||
      localStorage.getItem(`l8db.versioning.source.${project.id}`));
  if (stored)
    try {
      return JSON.parse(stored) as CompareSideSelection;
    } catch {
      return EMPTY_COMPARE_SIDE;
    }
  return activeKind === project?.kind
    ? { ...EMPTY_COMPARE_SIDE, connectionId: activeId }
    : EMPTY_COMPARE_SIDE;
}

export function useDatabaseDrift(workspace: VersioningWorkspace) {
  const { repo, project, status } = workspace;
  const connections = useConnectionsStore((state) => state.connections);
  const active = useActiveConnection();
  const [source, setSourceState] = useState<CompareSideSelection>(() =>
    initialSource(workspace, active?.id ?? null, active?.kind ?? null),
  );
  const [entries, setEntries] = useState<DriftEntry[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const alive = useRef(true);
  const connection = connections.find((item) => item.id === source.connectionId) ?? null;
  const mismatch = Boolean(connection && project && connection.kind !== project.kind);
  const ready = Boolean(connection && !mismatch && source.schema);
  const scope = connection
    ? [connection.name, source.database, source.schema].filter(Boolean).join(" · ")
    : "";
  const key = project && ready ? `${project.id}\u0000${status?.branch}\u0000${scope}` : "";
  const scan = useCallback(async () => {
    if (!project || !connection || mismatch || !source.schema)
      throw new Error("Eine passende Entwicklungsdatenbank mit Schema verknüpfen.");
    const request = ++revision.current;
    setScanning(true);
    setError(null);
    try {
      const result = await scanDrift(repo, project, connection, source, () => undefined);
      if (request !== revision.current || !alive.current) return;
      setEntries(result);
      setSelected(result.map((entry) => entry.object.id));
      setFocus((current) =>
        current && result.some((entry) => entry.object.id === current) ? current : null,
      );
      setScannedAt(Date.now());
    } catch (cause) {
      if (request === revision.current && alive.current)
        setError(String(cause).replace(/^Error: /, ""));
    } finally {
      if (request === revision.current && alive.current) setScanning(false);
    }
  }, [repo, project, connection, mismatch, source]);
  const scanned = useRef("");
  useEffect(() => {
    if (!key || scanned.current === key || workspace.dirty) return;
    scanned.current = key;
    void scan();
  }, [key, scan, workspace.dirty]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const setSource = (next: CompareSideSelection) => {
    if (!project) return;
    const filled =
      next.connectionId === source.connectionId &&
      !source.database &&
      Boolean(next.database) &&
      !next.schema &&
      Boolean(source.schema);
    const value = {
      ...next,
      schema: filled ? source.schema : next.schema,
      objectName: null,
      objectOid: null,
    };
    if (JSON.stringify(value) === JSON.stringify({ ...source, objectName: null, objectOid: null }))
      return;
    revision.current++;
    setSourceState(value);
    localStorage.setItem(sourceKey(project.id, status?.branch), JSON.stringify(value));
    setEntries(null);
    setSelected([]);
    setFocus(null);
    setScanning(false);
  };
  const take = async (ids: string[]) => {
    if (!project) return [];
    const chosen = (entries ?? []).filter((entry) => ids.includes(entry.object.id));
    if (!chosen.length) return [];
    await saveDrift(repo, project, workspace.projectText, chosen);
    const taken = new Set(chosen.map((entry) => entry.object.id));
    setEntries((items) => items?.filter((entry) => !taken.has(entry.object.id)) ?? null);
    setSelected((items) => items.filter((item) => !taken.has(item)));
    setFocus((current) => (current && taken.has(current) ? null : current));
    return chosen.flatMap((entry) => [
      ...Object.keys(entry.database ?? entry.repository),
      ...(entry.status === "changed" ? [] : ["database/project.json"]),
    ]);
  };
  return {
    source,
    setSource,
    connection,
    mismatch,
    ready,
    scope,
    entries,
    selected,
    setSelected,
    focus,
    setFocus,
    scanning,
    scannedAt,
    error,
    scan: () => void scan(),
    take,
  };
}

export type DatabaseDrift = ReturnType<typeof useDatabaseDrift>;

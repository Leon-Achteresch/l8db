import { targetStage } from "./delivery";
import { releasePath, releaseTrack } from "./model";
import { changedFiles } from "./status";
import type {
  DatabaseRelease,
  DatabaseTarget,
  RepositoryStatus,
  TargetStage,
  VersioningProject,
} from "./types";
import { customerGroups, progressIndex, targetProgress, type VersioningArea } from "./workflow";

export const PIPELINE_STAGES: TargetStage[] = ["development", "test", "production"];

export type PipelineProgress = ReturnType<typeof targetProgress>;

export interface PipelineEntry {
  target: DatabaseTarget;
  progress: PipelineProgress;
  current: boolean;
}

export interface PipelineRow {
  customer: string;
  cells: Record<TargetStage, PipelineEntry[]>;
}

export interface PipelineStage {
  stage: TargetStage;
  total: number;
  current: number;
  pending: number;
  blocked: number;
}

export function releaseTracks(releases: DatabaseRelease[], targets: DatabaseTarget[]) {
  const tracks = new Set<string>(["main"]);
  for (const release of releases) tracks.add(releaseTrack(release));
  for (const target of targets) tracks.add(target.track ?? "main");
  return ["main", ...[...tracks].filter((track) => track !== "main").sort()];
}

export function trackTip(
  releases: DatabaseRelease[],
  track: string,
  index: ReturnType<typeof progressIndex>,
) {
  let tip: DatabaseRelease | null = null;
  for (const release of index.available.values()) {
    if (releaseTrack(release) !== track) continue;
    if ((index.children.get(release.id) ?? []).some((child) => releaseTrack(child) === track))
      continue;
    if (!tip || release.createdAt > tip.createdAt) tip = release;
  }
  return tip ?? releases.filter((release) => releaseTrack(release) === track).at(-1) ?? null;
}

export function buildPipeline(
  targets: DatabaseTarget[],
  releases: DatabaseRelease[],
  status: RepositoryStatus | null,
  track: string,
) {
  const index = progressIndex(releases, status);
  const tip = trackTip(releases, track, index);
  const committed = Boolean(tip && index.available.has(tip.id));
  const members = targets.filter((target) => (target.track ?? "main") === track);
  const stages = Object.fromEntries(
    PIPELINE_STAGES.map((stage) => [
      stage,
      { stage, total: 0, current: 0, pending: 0, blocked: 0 },
    ]),
  ) as Record<TargetStage, PipelineStage>;
  const rows: PipelineRow[] = customerGroups(members).map((group) => {
    const cells: Record<TargetStage, PipelineEntry[]> = {
      development: [],
      test: [],
      production: [],
    };
    for (const target of group.targets) {
      const stage = targetStage(target);
      const progress = targetProgress(target, releases, status, index);
      const current = Boolean(tip && target.release?.id === tip.id);
      cells[stage].push({ target, progress, current });
      const summary = stages[stage];
      summary.total++;
      if (current) summary.current++;
      if (progress.state === "pending") summary.pending++;
      if (progress.state === "blocked" || progress.state === "baseline") summary.blocked++;
    }
    return { customer: group.customer, cells };
  });
  return { tip, committed, rows, stages: PIPELINE_STAGES.map((stage) => stages[stage]) };
}

export interface PipelineStep {
  title: string;
  detail: string;
  area: VersioningArea | "customer";
  action: string;
}

export function pipelineNextStep(
  project: VersioningProject,
  status: RepositoryStatus | null,
  releases: DatabaseRelease[],
  targets: DatabaseTarget[],
): PipelineStep | null {
  const changes = changedFiles(status?.changes ?? "");
  const committed = (release: DatabaseRelease) =>
    Boolean(status?.head) && !changes.has(releasePath(release.id));
  if (!project.objects.length)
    return {
      title: "Entwicklungsdatenbank aufnehmen",
      detail: "Schema vergleichen und die Objekte als Dateien ins Repository übernehmen.",
      area: "development",
      action: "Vergleichen",
    };
  if (changes.size)
    return {
      title: `${changes.size} ${changes.size === 1 ? "Datei" : "Dateien"} noch nicht committet`,
      detail: `Im Branch ${status?.branch ?? "HEAD"} prüfen und committen.`,
      area: "development",
      action: "Änderungen öffnen",
    };
  if (!releases.some((release) => !release.parent && committed(release)))
    return {
      title: "Ausgangsstand festhalten",
      detail: "Eine Baseline hält das vorhandene Schema ohne SQL-Ausführung fest.",
      area: "releases",
      action: "Baseline erstellen",
    };
  if (!targets.length)
    return {
      title: "Ersten Kunden anlegen",
      detail: "Test- und Produktivsystem zuordnen, damit Releases ausgerollt werden können.",
      area: "customer",
      action: "Kunde anlegen",
    };
  const index = progressIndex(releases, status);
  const open = targets.filter((target) => {
    const state = targetProgress(target, releases, status, index).state;
    return state === "blocked" || state === "baseline";
  });
  if (open.length)
    return {
      title: `${open.length} ${open.length === 1 ? "Ziel braucht" : "Ziele brauchen"} Klärung`,
      detail: open
        .slice(0, 3)
        .map((target) => target.name)
        .join(", "),
      area: "targets",
      action: "Kunden öffnen",
    };
  return null;
}

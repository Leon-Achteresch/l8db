import { targetStage } from "./delivery";
import type { DatabaseRelease, DatabaseTarget, TargetStage } from "./types";

export interface CommitMarks {
  releases: DatabaseRelease[];
  deployed: Record<TargetStage, DatabaseTarget[]>;
}

export function parseReleaseCommits(text: string) {
  const commits = new Map<string, string>();
  for (const block of text.split("\0")) {
    const [commit, ...files] = block.split("\n").filter(Boolean);
    if (!commit) continue;
    for (const file of files) {
      const id = /^database\/releases\/(.+)\.json$/.exec(file)?.[1];
      if (id && !commits.has(id)) commits.set(id, commit);
    }
  }
  return commits;
}

export function historyMarks(
  releases: DatabaseRelease[],
  targets: DatabaseTarget[],
  releaseCommits: Map<string, string>,
) {
  const marks = new Map<string, CommitMarks>();
  const at = (commit: string) => {
    let mark = marks.get(commit);
    if (!mark) {
      mark = { releases: [], deployed: { development: [], test: [], production: [] } };
      marks.set(commit, mark);
    }
    return mark;
  };
  for (const release of releases) {
    const commit = releaseCommits.get(release.id);
    if (commit) at(commit).releases.push(release);
  }
  for (const target of targets) {
    if (!target.release) continue;
    const commit = releaseCommits.get(target.release.id) ?? target.release.commit;
    if (commit) at(commit).deployed[targetStage(target)].push(target);
  }
  return marks;
}

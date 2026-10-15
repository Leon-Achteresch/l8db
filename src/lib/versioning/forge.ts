import { openUrl } from "@tauri-apps/plugin-opener";
import { versioningForge, versioningRepository } from "@/lib/db";
import { parseRelease, releaseTrack } from "./model";
import { readFile } from "./repository";
import {
  DEFAULT_TICKETS,
  findTickets,
  type TicketConfiguration,
  type TicketReference,
  ticketPrefix,
} from "./review";
import { releaseRisks } from "./safety";
import type { DatabaseRelease, VersioningProject } from "./types";

export type ForgeKind = "github" | "gitlab" | "azure" | "gitea";

export const FORGE_LABELS: Record<ForgeKind, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  azure: "Azure DevOps",
  gitea: "Gitea / Forgejo",
};

export interface ForgeInfo {
  remote: { kind: ForgeKind | null; host: string; path: string; web: string } | null;
  kind?: ForgeKind | null;
  connected: boolean;
  account?: string;
  defaultBranch?: string | null;
  tokenUrl?: string | null;
  problem?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  head: string;
  base: string;
  draft: boolean;
  state: "open" | "merged" | "closed";
  url: string;
  updatedAt: string;
  headSha: string | null;
  mergeSha: string | null;
}

export interface PullDetail {
  pull: PullRequest;
  body: string;
  approvals: string[];
  staleApprovals: string[];
  changesRequested: string[];
  mergeable: boolean | null;
  mergeState: string | null;
  checks: "success" | "failure" | "pending" | "none";
  own: boolean;
}

export interface PullComment {
  id: string;
  thread: string;
  author: string;
  body: string;
  createdAt: string;
  path: string | null;
  line: number | null;
  side: "new" | "old" | null;
  review: "approved" | "changes_requested" | "commented" | null;
  reply: boolean;
}

export interface CommentTarget {
  path?: string;
  line?: number;
  side?: "new" | "old";
  commit?: string | null;
  replyTo?: string;
}

export function pullComments(repo: string, number: number) {
  return forge<PullComment[]>(repo, "comments", { number });
}

export function commentPull(
  repo: string,
  number: number,
  body: string,
  target: CommentTarget = {},
) {
  return forge<null>(repo, "comment", {
    number,
    body,
    ...target,
    commit: target.commit ?? undefined,
  });
}

export function updatePull(
  repo: string,
  number: number,
  changes: { title?: string; body?: string; state?: "open" | "closed" },
) {
  return forge<PullRequest>(repo, "update", { number, ...changes });
}

export function commentThreads(comments: PullComment[]) {
  const threads = new Map<string, PullComment[]>();
  for (const comment of comments) {
    const list = threads.get(comment.thread);
    if (list) list.push(comment);
    else threads.set(comment.thread, [comment]);
  }
  return [...threads.values()];
}

export interface ChangedFile {
  status: string;
  path: string;
}

export interface BranchChanges {
  base: string;
  head: string;
  files: ChangedFile[];
}

export function forge<T>(repo: string, action: string, options: Record<string, unknown> = {}) {
  return versioningForge<T>({ ...options, repo, action });
}

export function openForgeUrl(url: string) {
  const parsed = new URL(url);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback))
    throw new Error("Diese Adresse wird aus Sicherheitsgründen nicht geöffnet.");
  return openUrl(parsed.toString());
}

export function branchChanges(repo: string, base: string, head: string) {
  return versioningRepository<BranchChanges>({ action: "between", repo, base, incoming: head });
}

const STATUS_LABELS: Record<string, string> = {
  A: "neu",
  M: "geändert",
  D: "gelöscht",
  T: "Typ geändert",
};

export function pullRequestBody(
  releases: DatabaseRelease[],
  files: ChangedFile[],
  tickets: TicketReference[] = [],
) {
  const lines: string[] = [];
  if (tickets.length) {
    lines.push("## Tickets", "");
    for (const ticket of tickets)
      lines.push(`- ${ticket.url ? `[${ticket.key}](${ticket.url})` : ticket.key}`);
    lines.push("");
  }
  if (releases.length) {
    lines.push("## Datenbank-Releases", "");
    for (const release of releases) {
      const plan = release.safety
        ? `${release.safety.phase}, ${release.safety.compatibility === "online" ? "online" : "Wartungsfenster"}`
        : "ohne Betriebsplan";
      lines.push(
        `- **${release.id}** · Linie ${releaseTrack(release)} · ${release.migrations.length} ${release.migrations.length === 1 ? "Migration" : "Migrationen"} · ${plan}`,
      );
      for (const migration of release.migrations) lines.push(`  - ${migration.title}`);
      for (const risk of releaseRisks(release)) lines.push(`  - ⚠️ ${risk}`);
      if (release.safety?.notes.trim()) lines.push(`  - Hinweis: ${release.safety.notes.trim()}`);
    }
    lines.push("");
  }
  if (files.length) {
    lines.push("## Geänderte Dateien", "");
    for (const file of files.slice(0, 100))
      lines.push(`- ${STATUS_LABELS[file.status] ?? file.status}: \`${file.path}\``);
    if (files.length > 100) lines.push(`- … und ${files.length - 100} weitere`);
    lines.push("");
  }
  lines.push(
    "## Prüfliste",
    "",
    "- [ ] Migrationen sind abwärtskompatibel oder ein Wartungsfenster ist eingeplant",
    "- [ ] Vor- und Nachprüfungen decken die Datenänderungen ab",
    "- [ ] Auswirkungen auf alle Kunden dieser Release-Linie sind bedacht",
    "",
    "_Ausgeliefert wird nur, was in den Hauptbranch gemergt ist. Produktion erst nach erfolgreichem Testsystem, sofern die Datenbankregeln das verlangen._",
  );
  return lines.join("\n");
}

export async function pullRequestDraft(
  repo: string,
  project: VersioningProject,
  base: string,
  head: string,
  branch: string,
  configuration: TicketConfiguration = DEFAULT_TICKETS,
) {
  const changes = await branchChanges(repo, base, head);
  const releases: DatabaseRelease[] = [];
  for (const file of changes.files) {
    if (file.status !== "A" || !/^database\/releases\/[^/]+\.json$/.test(file.path)) continue;
    const text = await readFile(repo, file.path, changes.head);
    if (text) releases.push(await parseRelease(text, project));
  }
  releases.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const tickets = findTickets([branch], configuration);
  const title = releases.length
    ? `Release ${releases.map((release) => release.id).join(", ")}`
    : `Datenbankänderungen aus ${branch}`;
  return {
    title: ticketPrefix(title, tickets),
    body: pullRequestBody(releases, changes.files, tickets),
    releases,
    files: changes.files,
  };
}

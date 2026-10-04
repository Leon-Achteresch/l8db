import { useQuery } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ExternalLinkIcon,
  GitMergeIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { versioningRepository } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  branchChanges,
  forge,
  openForgeUrl,
  type PullDetail,
  type PullRequest,
} from "@/lib/versioning/forge";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPullFile } from "./versioning-pull-file";
import { VersioningSelect } from "./versioning-select";

const CHECKS = {
  success: { label: "Prüfungen bestanden", icon: CircleCheckIcon, tone: "text-emerald-600" },
  failure: { label: "Prüfungen fehlgeschlagen", icon: CircleXIcon, tone: "text-destructive" },
  pending: { label: "Prüfungen laufen", icon: CircleDashedIcon, tone: "text-amber-600" },
  none: { label: "Keine Prüfungen", icon: CircleDashedIcon, tone: "text-muted-foreground" },
} as const;

export function VersioningPullDetail({
  workspace,
  pull,
  onChanged,
}: {
  workspace: VersioningWorkspace;
  pull: PullRequest;
  onChanged: () => void;
}) {
  const { repo, run } = workspace;
  const [comment, setComment] = useState("");
  const [method, setMethod] = useState("merge");
  const [merging, setMerging] = useState(false);
  const [file, setFile] = useState("");
  const detail = useQuery({
    queryKey: ["versioning-forge", repo, "pull", pull.number],
    retry: false,
    staleTime: 10_000,
    queryFn: () => forge<PullDetail>(repo, "pull", { number: pull.number }),
  });
  const changes = useQuery({
    queryKey: ["versioning-forge", repo, "files", pull.number, pull.headSha, pull.mergeSha],
    retry: false,
    queryFn: () =>
      pull.state === "merged" && pull.mergeSha
        ? branchChanges(repo, `${pull.mergeSha}^1`, pull.mergeSha)
        : branchChanges(
            repo,
            `refs/remotes/origin/${pull.base}`,
            pull.headSha ?? `refs/remotes/origin/${pull.head}`,
          ),
  });
  const review = (event: "approve" | "request_changes" | "comment", success: string) =>
    void run(async () => {
      await forge(repo, "review", { number: pull.number, event, body: comment.trim() });
      setComment("");
      await detail.refetch();
      onChanged();
    }, success);
  const merge = () =>
    void run(async () => {
      const result = await forge<{ merged: boolean }>(repo, "merge", {
        number: pull.number,
        method,
      });
      if (!result.merged)
        throw new Error("Die Plattform hat den Pull Request nicht gemergt. Status dort prüfen.");
      setMerging(false);
      await versioningRepository({ action: "fetch", repo });
      await workspace.refresh();
      onChanged();
    }, `Pull Request #${pull.number} gemergt`);
  const data = detail.data;
  const blockers = data
    ? [
        data.pull.draft && "Entwurf",
        !data.approvals.length && "noch keine aktuelle Freigabe einer anderen Person",
        data.changesRequested.length > 0 &&
          `Änderungswünsche von ${data.changesRequested.join(", ")}`,
        data.checks === "failure" && "Prüfungen fehlgeschlagen",
        data.checks === "pending" && "Prüfungen laufen noch",
        data.mergeable === false && "Konflikte oder Plattformregeln verhindern den Merge",
      ].filter((entry): entry is string => Boolean(entry))
    : [];
  const checks = CHECKS[data?.checks ?? "none"];
  return (
    <div className="ml-6 space-y-4 border-l border-border/60 py-3 pl-4 text-xs">
      {detail.isLoading && <Skeleton className="h-24 rounded-lg" />}
      {detail.error && (
        <p role="alert" className="text-[11px] text-destructive">
          {String(detail.error)}
        </p>
      )}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
            <span className="flex items-center gap-1.5">
              <CircleCheckIcon
                className={cn(
                  "size-3.5",
                  data.approvals.length ? "text-emerald-600" : "text-muted-foreground",
                )}
              />
              {data.approvals.length
                ? `Freigegeben von ${data.approvals.join(", ")}`
                : "Noch keine Freigabe"}
            </span>
            <span className={cn("flex items-center gap-1.5", checks.tone)}>
              <checks.icon className="size-3.5" />
              {checks.label}
            </span>
            {data.staleApprovals.length > 0 && (
              <span className="text-amber-700 dark:text-amber-300">
                Veraltet nach neuen Commits: {data.staleApprovals.join(", ")}
              </span>
            )}
            {data.changesRequested.length > 0 && (
              <span className="text-destructive">
                Änderungen angefordert: {data.changesRequested.join(", ")}
              </span>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-[11px]"
              onClick={() => void run(() => openForgeUrl(pull.url))}
            >
              <ExternalLinkIcon className="size-3.5" />
              Auf der Plattform öffnen
            </Button>
          </div>
          {data.body.trim() && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 font-sans text-[11px] leading-relaxed">
              {data.body}
            </pre>
          )}
        </>
      )}
      <div className="space-y-1.5">
        <p className="font-medium">Geänderte Datenbankdateien</p>
        {changes.isLoading && <Skeleton className="h-12 rounded-lg" />}
        {changes.error && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="flex-1">
              Der Stand des Pull Requests ist lokal noch nicht vorhanden. Zuerst abrufen.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() =>
                void run(async () => {
                  await versioningRepository({ action: "fetch", repo });
                  await changes.refetch();
                })
              }
            >
              Abrufen
            </Button>
          </div>
        )}
        {changes.data && !changes.data.files.length && (
          <p className="text-[11px] text-muted-foreground">Keine Änderungen unter database/.</p>
        )}
        <ul className="space-y-0.5">
          {changes.data?.files.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                aria-expanded={file === entry.path}
                onClick={() => setFile(file === entry.path ? "" : entry.path)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/40"
              >
                <span className="w-3 font-mono text-[10px] text-muted-foreground">
                  {entry.status}
                </span>
                <span className="truncate font-mono text-[11px]">{entry.path}</span>
              </button>
              {file === entry.path && changes.data && (
                <VersioningPullFile
                  repo={repo}
                  file={entry}
                  base={changes.data.base}
                  head={changes.data.head}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
      {pull.state === "open" && data && (
        <div className="space-y-2">
          <Textarea
            aria-label="Review-Kommentar"
            placeholder="Kommentar oder Begründung"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            className="min-h-20 text-xs"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={data.own}
              title={data.own ? "Eigene Pull Requests gibt eine andere Person frei." : undefined}
              onClick={() => review("approve", "Freigabe erteilt")}
            >
              Freigeben
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!comment.trim() || data.own}
              onClick={() => review("request_changes", "Änderungen angefordert")}
            >
              Änderungen anfordern
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!comment.trim()}
              onClick={() => review("comment", "Kommentar gespeichert")}
            >
              Kommentieren
            </Button>
          </div>
          <div className="space-y-2 rounded-lg bg-muted/30 p-3">
            {blockers.length > 0 ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Merge gesperrt: {blockers.join(" · ")}.
              </p>
            ) : merging ? (
              <>
                <VersioningSelect
                  label="Merge-Art"
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: "merge", label: "Merge-Commit (Historie bleibt erhalten)" },
                    { value: "squash", label: "Squash (ein Commit im Hauptbranch)" },
                  ]}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={merge}>
                    <GitMergeIcon className="size-3.5" />
                    In {pull.base} mergen
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setMerging(false)}>
                    Abbrechen
                  </Button>
                </div>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setMerging(true)}>
                <GitMergeIcon className="size-3.5" />
                Mergen…
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

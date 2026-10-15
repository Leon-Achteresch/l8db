import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  GitMergeIcon,
  PencilIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/branching/model";
import { versioningRepository } from "@/lib/db";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";
import {
  commentPull,
  commentThreads,
  forge,
  type PullComment,
  type PullDetail,
  type PullRequest,
  updatePull,
} from "@/lib/versioning/forge";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningCommentThread } from "./versioning-comment-thread";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningSelect } from "./versioning-select";

const CHECKS = {
  success: { label: "Prüfungen bestanden", icon: CircleCheckIcon, tone: "text-emerald-600" },
  failure: { label: "Prüfungen fehlgeschlagen", icon: CircleXIcon, tone: "text-destructive" },
  pending: { label: "Prüfungen laufen", icon: CircleDashedIcon, tone: "text-amber-600" },
  none: { label: "Keine Prüfungen", icon: CircleDashedIcon, tone: "text-muted-foreground" },
} as const;

export function VersioningPullConversation({
  workspace,
  pull,
  detail,
  comments,
  onChanged,
  onOpenFile,
  onReply,
}: {
  workspace: VersioningWorkspace;
  pull: PullRequest;
  detail: PullDetail;
  comments: PullComment[];
  onChanged: () => Promise<void>;
  onOpenFile: (path: string) => void;
  onReply: (thread: PullComment[], body: string) => Promise<void>;
}) {
  const { repo, run } = workspace;
  const now = useNow();
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(detail.body);
  const [method, setMethod] = useState("merge");
  const [merging, setMerging] = useState(false);
  const open = pull.state === "open";
  const review = (event: "approve" | "request_changes" | "comment", success: string) =>
    void run(async () => {
      const text = comment.trim();
      if (event === "comment") await commentPull(repo, pull.number, text);
      else await forge(repo, "review", { number: pull.number, event, body: text });
      setComment("");
      await onChanged();
    }, success);
  const saveBody = () =>
    void run(async () => {
      await updatePull(repo, pull.number, { body });
      setEditing(false);
      await onChanged();
    }, "Beschreibung gespeichert");
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
      await onChanged();
    }, `Pull Request #${pull.number} gemergt`);
  const blockers = [
    detail.pull.draft && "Entwurf",
    !detail.approvals.length && "noch keine aktuelle Freigabe einer anderen Person",
    detail.changesRequested.length > 0 &&
      `Änderungswünsche von ${detail.changesRequested.join(", ")}`,
    detail.checks === "failure" && "Prüfungen fehlgeschlagen",
    detail.checks === "pending" && "Prüfungen laufen noch",
    detail.mergeable === false && "Konflikte oder Plattformregeln verhindern den Merge",
  ].filter((entry): entry is string => Boolean(entry));
  const checks = CHECKS[detail.checks];
  const threads = commentThreads(comments);
  return (
    <div className="space-y-4 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <span className="flex items-center gap-1.5">
          <CircleCheckIcon
            className={cn(
              "size-3.5",
              detail.approvals.length ? "text-emerald-600" : "text-muted-foreground",
            )}
          />
          {detail.approvals.length
            ? `Freigegeben von ${detail.approvals.join(", ")}`
            : "Noch keine Freigabe"}
        </span>
        <span className={cn("flex items-center gap-1.5", checks.tone)}>
          <checks.icon className="size-3.5" />
          {checks.label}
        </span>
        {detail.staleApprovals.length > 0 && (
          <span className="text-amber-700 dark:text-amber-300">
            Veraltet nach neuen Commits: {detail.staleApprovals.join(", ")}
          </span>
        )}
        {detail.changesRequested.length > 0 && (
          <span className="text-destructive">
            Änderungen angefordert: {detail.changesRequested.join(", ")}
          </span>
        )}
      </div>
      <article className="rounded-lg border border-border/60">
        <header className="flex items-center gap-1.5 border-b border-border/60 bg-muted/30 px-3 py-1.5 text-[11px]">
          <span className="font-medium">{pull.author}</span>
          <span className="text-muted-foreground">
            möchte {pull.head} in {pull.base} übernehmen
            {pull.updatedAt ? ` · ${relativeTime(pull.updatedAt, now)}` : ""}
          </span>
          {!editing && (
            <VersioningIconButton
              icon={PencilIcon}
              label="Beschreibung bearbeiten"
              className="ml-auto size-6 [&_svg]:size-3.5"
              onClick={() => {
                setBody(detail.body);
                setEditing(true);
              }}
            />
          )}
        </header>
        {editing ? (
          <div className="space-y-2 p-3">
            <Textarea
              aria-label="Beschreibung des Pull Requests"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-48 font-mono text-[11px]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveBody}>
                Speichern
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Abbrechen
              </Button>
            </div>
          </div>
        ) : (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 font-sans text-[11px] leading-relaxed">
            {detail.body.trim() || "Keine Beschreibung."}
          </pre>
        )}
      </article>
      {threads.length > 0 && (
        <ol className="space-y-2" aria-label="Unterhaltung">
          {threads.map((thread) => (
            <li key={thread[0].thread}>
              <VersioningCommentThread
                comments={thread}
                onOpenFile={onOpenFile}
                onReply={
                  thread[0].path && thread[0].line ? (text) => onReply(thread, text) : undefined
                }
              />
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-2">
        <Textarea
          aria-label="Kommentar"
          placeholder={open ? "Kommentar oder Begründung für das Review" : "Kommentar"}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className="min-h-20 text-xs"
        />
        <div className="flex flex-wrap gap-2">
          {open && (
            <>
              <Button
                size="sm"
                disabled={detail.own}
                title={
                  detail.own ? "Eigene Pull Requests gibt eine andere Person frei." : undefined
                }
                onClick={() => review("approve", "Freigabe erteilt")}
              >
                Freigeben
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!comment.trim() || detail.own}
                onClick={() => review("request_changes", "Änderungen angefordert")}
              >
                Änderungen anfordern
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!comment.trim()}
            onClick={() => review("comment", "Kommentar gespeichert")}
          >
            Kommentieren
          </Button>
        </div>
      </div>
      {open && (
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
      )}
    </div>
  );
}

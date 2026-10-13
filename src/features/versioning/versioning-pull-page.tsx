import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  GitPullRequestArrowIcon,
  GitPullRequestClosedIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  commentPull,
  forge,
  openForgeUrl,
  type PullComment,
  type PullDetail,
  type PullRequest,
  pullComments,
  updatePull,
} from "@/lib/versioning/forge";
import { findTickets } from "@/lib/versioning/review";
import type { TicketsState } from "./use-tickets";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningPullChanges } from "./versioning-pull-changes";
import { VersioningPullConversation } from "./versioning-pull-conversation";
import { VersioningPullState } from "./versioning-pull-state";
import { VersioningTicketChips } from "./versioning-ticket-chips";

export function VersioningPullPage({
  workspace,
  pull,
  tickets,
  onBack,
  onChanged,
}: {
  workspace: VersioningWorkspace;
  pull: PullRequest;
  tickets: TicketsState;
  onBack: () => void;
  onChanged: () => void;
}) {
  const { repo, run } = workspace;
  const [tab, setTab] = useState<"conversation" | "changes">("conversation");
  const [focus, setFocus] = useState("");
  const [title, setTitle] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["versioning-forge", repo, "pull", pull.number],
    retry: false,
    staleTime: 10_000,
    queryFn: () => forge<PullDetail>(repo, "pull", { number: pull.number }),
  });
  const comments = useQuery({
    queryKey: ["versioning-forge", repo, "comments", pull.number],
    retry: false,
    staleTime: 10_000,
    queryFn: () => pullComments(repo, pull.number),
  });
  const current = detail.data?.pull ?? pull;
  const found = useMemo(
    () => findTickets([current.title, current.head, detail.data?.body], tickets.configuration),
    [current.title, current.head, detail.data?.body, tickets.configuration],
  );
  const refresh = async () => {
    await Promise.all([detail.refetch(), comments.refetch()]);
    onChanged();
  };
  const act = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      toast.success(success);
    } catch (cause) {
      toast.error(String(cause).replace(/^Error: /, ""));
      throw cause;
    }
  };
  const lineComment = async (path: string, line: number, side: "new" | "old", body: string) => {
    await act(async () => {
      await commentPull(repo, pull.number, body, {
        path,
        line,
        side,
        commit: current.headSha,
      });
      await comments.refetch();
    }, "Zeilenkommentar gespeichert");
  };
  const reply = async (thread: PullComment[], body: string) => {
    const root = thread[0];
    await act(async () => {
      await commentPull(repo, pull.number, body, {
        replyTo: root.thread,
        path: root.path ?? undefined,
        line: root.line ?? undefined,
        side: root.side ?? undefined,
        commit: current.headSha,
      });
      await comments.refetch();
    }, "Antwort gespeichert");
  };
  const saveTitle = () =>
    void run(async () => {
      const next = title?.trim();
      if (!next || next === current.title) {
        setTitle(null);
        return;
      }
      await updatePull(repo, pull.number, { title: next });
      setTitle(null);
      await refresh();
    }, "Titel gespeichert");
  const setState = (state: "open" | "closed") =>
    void run(
      async () => {
        await updatePull(repo, pull.number, { state });
        await refresh();
      },
      state === "closed"
        ? `Pull Request #${pull.number} geschlossen`
        : "Pull Request wieder geöffnet",
    );
  const lineThreads = (comments.data ?? []).filter((comment) => comment.path).length;
  return (
    <article className="space-y-4" aria-label={`Pull Request #${pull.number}`}>
      <header className="space-y-2">
        <div className="flex items-start gap-1.5">
          <VersioningIconButton
            icon={ArrowLeftIcon}
            label="Zurück zu allen Pull Requests"
            className="-ml-2 size-7"
            onClick={onBack}
          />
          <div className="min-w-0 flex-1 pt-0.5">
            {title !== null ? (
              <Input
                autoFocus
                aria-label="Titel des Pull Requests"
                value={title}
                maxLength={250}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={saveTitle}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveTitle();
                  if (event.key === "Escape") setTitle(null);
                }}
                className="h-7 text-sm font-semibold"
              />
            ) : (
              <h2 className="text-sm font-semibold leading-snug break-words">
                {current.title}{" "}
                <span className="font-normal text-muted-foreground">#{current.number}</span>
              </h2>
            )}
          </div>
          <div className="flex shrink-0 items-center">
            {current.state !== "merged" && title === null && (
              <VersioningIconButton
                icon={PencilIcon}
                label="Titel bearbeiten"
                className="size-7"
                onClick={() => setTitle(current.title)}
              />
            )}
            <VersioningIconButton
              icon={RefreshCwIcon}
              label="Neu laden"
              className="size-7"
              onClick={() => void refresh()}
            />
            {current.state === "open" && (
              <VersioningIconButton
                icon={GitPullRequestClosedIcon}
                label="Pull Request schließen"
                className="size-7"
                onClick={() => setState("closed")}
              />
            )}
            {current.state === "closed" && (
              <VersioningIconButton
                icon={GitPullRequestArrowIcon}
                label="Pull Request wieder öffnen"
                className="size-7"
                onClick={() => setState("open")}
              />
            )}
            <VersioningIconButton
              icon={ExternalLinkIcon}
              label="Auf der Plattform öffnen"
              className="size-7"
              onClick={() => void run(() => openForgeUrl(current.url))}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-[11px] text-muted-foreground">
          <VersioningPullState pull={current} />
          <span>
            {current.author} ·{" "}
            <span className="font-mono">
              {current.head} → {current.base}
            </span>
          </span>
          <VersioningTicketChips tickets={found} />
        </div>
      </header>
      <div
        role="tablist"
        aria-label="Pull-Request-Bereiche"
        className="flex gap-1 border-b border-border/60"
      >
        {(
          [
            ["conversation", "Unterhaltung", comments.data?.length ?? 0],
            ["changes", "Datenbankänderungen", lineThreads],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "relative px-2.5 pb-2 text-xs transition-colors",
              tab === id
                ? "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {count > 0 && (
              <span className="ml-1.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                {count}
              </span>
            )}
          </button>
        ))}
      </div>
      {(detail.error || comments.error) && (
        <p role="alert" className="rounded-lg bg-destructive/5 p-3 text-[11px] text-destructive">
          {String(detail.error ?? comments.error)}
        </p>
      )}
      {tab === "conversation" ? (
        detail.data ? (
          <VersioningPullConversation
            key={detail.data.pull.number}
            workspace={workspace}
            pull={current}
            detail={detail.data}
            comments={comments.data ?? []}
            onChanged={refresh}
            onOpenFile={(path) => {
              setFocus(path);
              setTab("changes");
            }}
            onReply={reply}
          />
        ) : (
          <Skeleton className="h-40 rounded-lg" />
        )
      ) : (
        <VersioningPullChanges
          workspace={workspace}
          pull={current}
          comments={comments.data ?? []}
          focus={focus}
          onFocus={setFocus}
          onComment={current.state === "open" ? lineComment : undefined}
          onReply={current.state === "open" ? reply : undefined}
        />
      )}
    </article>
  );
}

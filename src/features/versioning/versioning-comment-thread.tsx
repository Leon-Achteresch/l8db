import { CircleCheckIcon, CircleXIcon, CornerDownRightIcon, FileCodeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/branching/model";
import { useNow } from "@/lib/hooks/use-now";
import { cn } from "@/lib/utils";
import type { PullComment } from "@/lib/versioning/forge";

const REVIEW_LABELS = {
  approved: { label: "hat freigegeben", icon: CircleCheckIcon, tone: "text-emerald-600" },
  changes_requested: { label: "fordert Änderungen", icon: CircleXIcon, tone: "text-destructive" },
  commented: { label: "hat geprüft", icon: CornerDownRightIcon, tone: "text-muted-foreground" },
} as const;

export function VersioningCommentThread({
  comments,
  onReply,
  onOpenFile,
  compact = false,
}: {
  comments: PullComment[];
  onReply?: (body: string) => Promise<void>;
  onOpenFile?: (path: string) => void;
  compact?: boolean;
}) {
  const now = useNow();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const first = comments[0];
  if (!first) return null;
  const send = async () => {
    if (!onReply || !text.trim()) return;
    setSending(true);
    try {
      await onReply(text.trim());
      setText("");
      setReplying(false);
    } catch {
    } finally {
      setSending(false);
    }
  };
  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60 bg-background font-sans text-xs",
        compact ? "p-2.5" : "p-3",
      )}
    >
      {first.path && onOpenFile && (
        <button
          type="button"
          onClick={() => onOpenFile(first.path ?? "")}
          className="flex max-w-full items-center gap-1.5 truncate text-[10px] text-muted-foreground hover:text-foreground"
        >
          <FileCodeIcon className="size-3 shrink-0" />
          <span className="truncate font-mono">
            {first.path}
            {first.line ? `:${first.line}` : ""}
          </span>
        </button>
      )}
      {comments.map((comment) => {
        const review = comment.review ? REVIEW_LABELS[comment.review] : null;
        return (
          <article key={comment.id} className={cn("space-y-1", comment.reply && "pl-4")}>
            <header className="flex items-center gap-1.5 text-[11px]">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase">
                {comment.author.slice(0, 1) || "?"}
              </span>
              <span className="font-medium">{comment.author}</span>
              {review && (
                <span className={cn("flex items-center gap-1", review.tone)}>
                  <review.icon className="size-3" />
                  {review.label}
                </span>
              )}
              {comment.createdAt && (
                <time dateTime={comment.createdAt} className="text-[10px] text-muted-foreground">
                  {relativeTime(comment.createdAt, now)}
                </time>
              )}
            </header>
            {comment.body.trim() && (
              <p className="whitespace-pre-wrap break-words pl-6.5 text-[11px] leading-relaxed">
                {comment.body}
              </p>
            )}
          </article>
        );
      })}
      {onReply &&
        (replying ? (
          <div className="space-y-1.5 pl-6.5">
            <Textarea
              autoFocus
              aria-label="Antwort"
              placeholder="Antworten"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
              }}
              className="min-h-16 text-xs"
            />
            <div className="flex gap-1.5">
              <Button size="sm" disabled={!text.trim() || sending} onClick={() => void send()}>
                Antworten
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReplying(false)}>
                Abbrechen
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="pl-6.5 text-[11px] text-muted-foreground hover:text-foreground"
          >
            Antworten…
          </button>
        ))}
    </div>
  );
}

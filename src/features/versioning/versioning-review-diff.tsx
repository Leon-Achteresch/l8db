import { MessageSquarePlusIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PullComment } from "@/lib/versioning/forge";
import { reviewRows } from "@/lib/versioning/review";
import { VersioningCommentThread } from "./versioning-comment-thread";

const PAGE = 1500;

type Side = "new" | "old";

export function VersioningReviewDiff({
  before,
  after,
  threads,
  onComment,
  onReply,
}: {
  before: string;
  after: string;
  threads: PullComment[][];
  onComment?: (line: number, side: Side, body: string) => Promise<void>;
  onReply?: (thread: PullComment[], body: string) => Promise<void>;
}) {
  const rows = useMemo(() => reviewRows(before, after), [before, after]);
  const [limit, setLimit] = useState(PAGE);
  const [draft, setDraft] = useState<{ line: number; side: Side } | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const placed = useMemo(() => {
    const visible = new Set<string>();
    for (const row of rows) {
      if (row.kind === "gap") continue;
      if (row.new !== null) visible.add(`new:${row.new}`);
      if (row.old !== null) visible.add(`old:${row.old}`);
    }
    const at = new Map<string, PullComment[][]>();
    const loose: PullComment[][] = [];
    for (const thread of threads) {
      const key = `${thread[0].side ?? "new"}:${thread[0].line}`;
      if (!visible.has(key)) loose.push(thread);
      else at.set(key, [...(at.get(key) ?? []), thread]);
    }
    return { at, loose };
  }, [rows, threads]);
  const send = async () => {
    if (!draft || !onComment || !text.trim()) return;
    setSending(true);
    try {
      await onComment(draft.line, draft.side, text.trim());
      setText("");
      setDraft(null);
    } catch {
    } finally {
      setSending(false);
    }
  };
  if (!rows.length)
    return <p className="px-3 py-4 text-[11px] text-muted-foreground">Inhalt unverändert.</p>;
  return (
    <div className="min-w-0 space-y-2">
      {placed.loose.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">Kommentare zu älteren Ständen</p>
          {placed.loose.map((thread) => (
            <VersioningCommentThread
              key={thread[0].thread}
              comments={thread}
              compact
              onReply={onReply ? (body) => onReply(thread, body) : undefined}
            />
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border/60 bg-muted/10 font-mono text-[11px] leading-5">
        <table className="w-full border-collapse">
          <tbody>
            {rows.slice(0, limit).map((row) => {
              if (row.kind === "gap")
                return (
                  <tr key={`gap-${row.from}`} className="bg-muted/40 text-muted-foreground">
                    <td colSpan={4} className="px-3 py-0.5 text-[10px]">
                      ⋯ {row.hidden} unveränderte {row.hidden === 1 ? "Zeile" : "Zeilen"}
                    </td>
                  </tr>
                );
              const side: Side = row.kind === "remove" ? "old" : "new";
              const line = side === "old" ? row.old : row.new;
              const here = [
                ...(row.new !== null ? (placed.at.get(`new:${row.new}`) ?? []) : []),
                ...(row.old !== null ? (placed.at.get(`old:${row.old}`) ?? []) : []),
              ];
              const open = draft?.side === side && draft.line === line;
              return (
                <Fragment key={`${row.kind}-${row.old}-${row.new}`}>
                  <tr
                    className={cn(
                      "group",
                      row.kind === "add" && "bg-emerald-500/10",
                      row.kind === "remove" && "bg-red-500/10",
                    )}
                  >
                    <td className="w-10 select-none px-1.5 text-right align-top text-muted-foreground/70">
                      {row.old ?? ""}
                    </td>
                    <td className="relative w-10 select-none px-1.5 text-right align-top text-muted-foreground/70">
                      {onComment && line !== null && (
                        <button
                          type="button"
                          aria-label={`Kommentar zu Zeile ${line}`}
                          title="Kommentar zu dieser Zeile"
                          onClick={() => {
                            setDraft({ line, side });
                            setText("");
                          }}
                          className="absolute top-0.5 -left-2 hidden size-4 items-center justify-center rounded bg-primary text-primary-foreground group-hover:flex focus-visible:flex"
                        >
                          <MessageSquarePlusIcon className="size-3" />
                        </button>
                      )}
                      {row.new ?? ""}
                    </td>
                    <td
                      className={cn(
                        "w-4 select-none text-center align-top",
                        row.kind === "add" && "text-emerald-700 dark:text-emerald-400",
                        row.kind === "remove" && "text-red-700 dark:text-red-400",
                      )}
                    >
                      {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : ""}
                    </td>
                    <td className="whitespace-pre pr-3 align-top">{row.text || " "}</td>
                  </tr>
                  {(here.length > 0 || open) && (
                    <tr>
                      <td colSpan={4} className="space-y-2 bg-muted/20 px-3 py-2">
                        {here.map((thread) => (
                          <VersioningCommentThread
                            key={thread[0].thread}
                            comments={thread}
                            compact
                            onReply={onReply ? (body) => onReply(thread, body) : undefined}
                          />
                        ))}
                        {open && (
                          <div className="space-y-1.5 font-sans">
                            <Textarea
                              autoFocus
                              aria-label={`Kommentar zu Zeile ${line}`}
                              placeholder="Kommentar zu dieser Zeile"
                              value={text}
                              onChange={(event) => setText(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" && (event.metaKey || event.ctrlKey))
                                  void send();
                                if (event.key === "Escape") setDraft(null);
                              }}
                              className="min-h-16 text-xs"
                            />
                            <div className="flex gap-1.5">
                              <Button
                                size="sm"
                                disabled={!text.trim() || sending}
                                onClick={() => void send()}
                              >
                                Kommentieren
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                                Abbrechen
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE)}>
          Weitere {Math.min(PAGE, rows.length - limit)} von {rows.length - limit} Zeilen anzeigen
        </Button>
      )}
    </div>
  );
}

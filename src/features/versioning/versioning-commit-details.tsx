import { CopyIcon, XIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/branching/model";
import { versioningRepository } from "@/lib/db";
import { errorMessageOf } from "@/lib/error-details";
import { cn } from "@/lib/utils";
import {
  type CommitDetails,
  type PatchStatus,
  parseCommitPatch,
} from "@/lib/versioning/commit-patch";
import { VersioningPatchView } from "./versioning-patch-view";

const STATUS: Record<PatchStatus, { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-emerald-600 dark:text-emerald-400", label: "Neu" },
  deleted: { letter: "D", className: "text-red-600 dark:text-red-400", label: "Gelöscht" },
  renamed: { letter: "R", className: "text-sky-600 dark:text-sky-400", label: "Umbenannt" },
  modified: { letter: "M", className: "text-amber-600 dark:text-amber-400", label: "Geändert" },
};

export function VersioningCommitDetails({
  repo,
  commitId,
  onClose,
}: {
  repo: string;
  commitId: string;
  onClose: () => void;
}) {
  const [details, setDetails] = useState<CommitDetails | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    let active = true;
    setDetails(null);
    setError("");
    setSelected(0);
    versioningRepository<CommitDetails>({ action: "show", repo, revision: commitId })
      .then((value) => {
        if (active) setDetails(value);
      })
      .catch((cause) => {
        if (active) setError(errorMessageOf(cause));
      });
    return () => {
      active = false;
    };
  }, [repo, commitId]);
  const files = useMemo(() => (details ? parseCommitPatch(details.patch) : []), [details]);
  const [subject, ...body] = (details?.message ?? "").split("\n");
  const file = files[selected];
  const copy = () =>
    void navigator.clipboard
      .writeText(commitId)
      .then(() => toast.success("Commit-Hash kopiert"))
      .catch((cause) => toast.error(String(cause)));
  return (
    <aside
      aria-label="Commit-Details"
      className="flex min-h-0 w-[52%] min-w-[380px] shrink-0 flex-col bg-muted/30"
    >
      <header className="flex shrink-0 items-start gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] leading-5 font-semibold tracking-tight">
            {subject || (error ? "Commit" : "Wird geladen…")}
          </h3>
          {body.join("\n").trim() && (
            <p className="mt-1 max-h-24 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
              {body.join("\n").trim()}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            {details && <span className="font-medium text-foreground/80">{details.author}</span>}
            {details && (
              <span title={new Date(details.date).toLocaleString()}>
                {relativeTime(details.date)}
              </span>
            )}
            <button
              type="button"
              onClick={copy}
              title="Commit-Hash kopieren"
              className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] transition-colors hover:bg-muted-foreground/15 hover:text-foreground"
            >
              {commitId.slice(0, 10)}
              <CopyIcon className="size-2.5" />
            </button>
          </div>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-7 shrink-0 rounded-full"
          aria-label="Details schließen"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </Button>
      </header>
      {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
      {details && !files.length && (
        <p className="px-4 py-2 text-xs text-muted-foreground">Keine Dateiänderungen</p>
      )}
      {files.length > 0 && (
        <ul aria-label="Geänderte Dateien" className="max-h-44 shrink-0 overflow-auto px-2 pb-2">
          {files.map((entry, index) => {
            const status = STATUS[entry.status];
            const slash = entry.path.lastIndexOf("/");
            return (
              <li key={`${entry.from ?? ""}:${entry.path}`}>
                <button
                  type="button"
                  aria-current={index === selected}
                  onClick={() => setSelected(index)}
                  className={cn(
                    "flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-xs transition-colors hover:bg-muted",
                    index === selected && "bg-muted",
                  )}
                >
                  <span
                    title={status.label}
                    className={cn(
                      "w-3 shrink-0 font-mono text-[10px] font-semibold",
                      status.className,
                    )}
                  >
                    {status.letter}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate"
                    title={entry.from ? `${entry.from} → ${entry.path}` : entry.path}
                  >
                    <span className="text-muted-foreground">{entry.path.slice(0, slash + 1)}</span>
                    {entry.path.slice(slash + 1)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums">
                    {entry.added > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">+{entry.added}</span>
                    )}
                    {entry.removed > 0 && (
                      <span className="ml-1 text-red-600 dark:text-red-400">−{entry.removed}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {file && <VersioningPatchView key={`${commitId}:${selected}`} file={file} />}
    </aside>
  );
}

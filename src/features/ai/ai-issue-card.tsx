import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleDot,
  Crosshair,
  Eye,
  Image,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ISSUE_LABELS, ISSUE_REPOSITORY } from "@/lib/ai/issue-presentation";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AiIssueGithubPreview } from "./ai-issue-github-preview";

export function AiIssueCard({
  title,
  body,
  screenshot,
  url,
  status = "draft",
  error,
  pending = false,
  onPublish,
  onCancel,
  onPick,
}: {
  title: string;
  body: string;
  screenshot?: string;
  url?: string;
  status?: "draft" | "running" | "success" | "error" | "cancelled";
  error?: string;
  pending?: boolean;
  onPublish?: () => void;
  onCancel?: () => void;
  onPick?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const picker = useNewFeatureVisibility<HTMLButtonElement>("ai.chat.issue-cards.area-picker");
  const label =
    status === "draft"
      ? "Bereit zur Prüfung"
      : status === "running"
        ? "Wird gesendet …"
        : status === "success" && url
          ? "Issue erstellt"
          : status === "cancelled"
            ? "Nicht gesendet"
            : "Senden fehlgeschlagen";
  const number = url?.split("/").at(-1);
  return (
    <article
      data-ai-issue-card
      className="my-3 rounded-2xl bg-card p-3.5 shadow-[0_1px_2px_oklch(0_0_0/5%),0_8px_24px_-12px_oklch(0_0_0/16%)]"
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full ${
            status === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-[#1f883d]/15 text-[#1f883d] dark:text-[#3fb950]"
          }`}
        >
          {status === "running" || pending ? (
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
          ) : status === "success" && url ? (
            <Check className="size-4" />
          ) : status === "error" ? (
            <CircleAlert className="size-4" />
          ) : (
            <CircleDot className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted-foreground">
            {ISSUE_REPOSITORY}
            {number ? ` · #${number}` : ""}
          </p>
          <h3 className="mt-0.5 line-clamp-2 break-words text-sm font-semibold">
            {title || "Fehlerbericht"}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <span role="status" className="font-medium text-foreground/80">
              {label}
            </span>
            {ISSUE_LABELS.map((issueLabel) => (
              <span
                key={issueLabel.name}
                style={{ backgroundColor: `#${issueLabel.color}` }}
                className={`rounded-full px-1.5 text-[10px] font-medium leading-4 ${issueLabel.dark ? "text-white" : "text-black"}`}
              >
                {issueLabel.name}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <ShieldCheck className="size-3" /> Diagnose
            </span>
            {screenshot && (
              <span className="flex items-center gap-1">
                <Image className="size-3" /> Screenshot geschwärzt
              </span>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-1.5 break-words text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Abbrechen
          </Button>
        )}
        {onPick && (
          <Button
            ref={picker.ref}
            size="sm"
            variant="ghost"
            disabled={pending}
            title="Element für den Screenshot wählen · ↑ ↓ Ebene · Esc abbrechen"
            onClick={onPick}
          >
            <Crosshair className="size-3.5" />
            Bereich wählen
            {picker.isNew && <NewBadge />}
          </Button>
        )}
        {url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              Auf GitHub
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        )}
        <Button
          size="sm"
          variant={onPublish ? "default" : "secondary"}
          disabled={pending}
          onClick={() => setOpen(true)}
        >
          <Eye className="size-3.5" />
          Vorschau
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent className="flex h-[92dvh] max-h-[92dvh] w-[min(72rem,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
            <DialogHeader className="shrink-0 px-6 pt-5 pr-14 pb-3">
              <DialogTitle className="text-sm">Issue-Vorschau</DialogTitle>
              <DialogDescription className="text-xs">
                So erscheint der Bericht öffentlich auf GitHub. Prüfe alle Inhalte auf sensible
                Daten, bevor du ihn sendest.
              </DialogDescription>
            </DialogHeader>
            <div
              data-issue-preview-scroll
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background px-6 py-5 sm:px-8"
            >
              <AiIssueGithubPreview
                title={title}
                body={body}
                screenshot={screenshot}
                number={number}
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 bg-muted/30 px-6 py-3">
              <span className="mr-auto text-xs text-muted-foreground">Öffentlich sichtbar</span>
              <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Schließen
              </Button>
              {onPublish && (
                <Button
                  disabled={pending}
                  onClick={onPublish}
                  className="bg-[#1f883d] text-white hover:bg-[#1a7f37]"
                >
                  {pending ? "Wird gesendet …" : "Öffentliches Issue erstellen"}
                </Button>
              )}
              {url && (
                <Button asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    Auf GitHub öffnen
                    <ArrowUpRight className="size-4" />
                  </a>
                </Button>
              )}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </article>
  );
}

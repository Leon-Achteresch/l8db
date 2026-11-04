import {
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleDot,
  Eye,
  Image,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AiMarkdown } from "./ai-markdown";

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
}) {
  const [open, setOpen] = useState(false);
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
  return (
    <article
      data-ai-issue-card
      className="my-2 overflow-hidden rounded-xl border border-primary/20 bg-card shadow-sm"
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
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
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            GitHub · Leon-Achteresch/l8db
          </p>
          <h3 className="mt-1 line-clamp-2 break-words text-sm font-semibold">
            {title || "Fehlerbericht"}
          </h3>
          <p role="status" className="mt-1 text-xs text-muted-foreground">
            {label}
            {url ? ` · #${url.split("/").at(-1)}` : ""}
          </p>
          {error && (
            <p role="alert" className="mt-1 break-words text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-y bg-muted/25 px-3.5 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ShieldCheck className="size-3.5" /> Diagnose enthalten
        </span>
        {screenshot && (
          <span className="flex items-center gap-1">
            <Image className="size-3.5" /> Screenshot geschwärzt
          </span>
        )}
        <span>Öffentlich sichtbar</span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 p-2.5">
        <Button size="sm" variant="ghost" className="mr-auto" onClick={() => setOpen(true)}>
          <Eye className="size-3.5" />
          Vorschau
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
            Abbrechen
          </Button>
        )}
        {onPublish && (
          <Button size="sm" disabled={pending} onClick={() => setOpen(true)}>
            Issue prüfen
          </Button>
        )}
        {url && (
          <Button size="sm" variant="outline" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              Auf GitHub
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent className="max-h-[85dvh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
            <DialogHeader className="border-b px-6 py-5 pr-14">
              <DialogTitle>Issue-Vorschau</DialogTitle>
              <DialogDescription>
                So wird dein Bericht öffentlich auf GitHub angezeigt. Prüfe vor dem Senden auch die
                geschwärzten Inhalte.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[55dvh] space-y-5 overflow-auto px-6 py-5">
              <div>
                <h2 className="break-words text-xl font-semibold tracking-tight">
                  {title || "Fehlerbericht"}
                </h2>
                <p className="mt-2 text-xs text-muted-foreground">
                  Leon-Achteresch/l8db · bug · ai-report
                </p>
              </div>
              <div className="break-words">
                <AiMarkdown source={body || "Der Bericht wird vorbereitet."} />
              </div>
              {screenshot && (
                <figure className="space-y-2">
                  <figcaption className="text-xs text-muted-foreground">
                    Geschwärzter Screenshot, der mitgesendet wird
                  </figcaption>
                  <img
                    src={screenshot}
                    alt="Geschwärzter Screenshot für das GitHub-Issue"
                    className="max-h-80 w-full rounded-lg border object-contain"
                  />
                </figure>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-6 py-4">
              <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Schließen
              </Button>
              {onPublish && (
                <Button disabled={pending} onClick={onPublish}>
                  {pending ? "Wird gesendet …" : "Öffentliches Issue erstellen"}
                  <ArrowUpRight className="size-4" />
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

import type { Update } from "@tauri-apps/plugin-updater";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useUpdatePrompt } from "@/lib/hooks/use-update-prompt";
import { closeUpdatePrompt, installUpdateAndRelaunch } from "@/lib/updater";

function publishedOn(date: string | undefined): string {
  if (!date) return "Eine neue Version steht bereit.";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "Eine neue Version steht bereit.";
  return `Veröffentlicht am ${parsed.toLocaleDateString("de-DE")}`;
}

export function UpdateAvailableDialog() {
  const { update, open } = useUpdatePrompt();
  const [percent, setPercent] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  async function onInstall(next: Update) {
    setFailed(false);
    setPercent(0);
    try {
      await installUpdateAndRelaunch(next, setPercent);
    } catch {
      setPercent(null);
      setFailed(true);
    }
  }

  function onOpenChange(next: boolean) {
    if (percent !== null) return;
    if (!next) {
      setFailed(false);
      closeUpdatePrompt();
    }
  }

  return (
    <Dialog open={open && update !== null} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 p-5 sm:max-w-xl"
        aria-describedby={undefined}
      >
        {update ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-sm font-semibold">
                  Version {update.version} ist verfügbar
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-xs leading-relaxed">
                  {publishedOn(update.date)}
                </DialogDescription>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={percent !== null}>
                  Später
                </Button>
                <Button onClick={() => void onInstall(update)} disabled={percent !== null}>
                  {percent !== null ? "Installiert …" : "Installieren"}
                </Button>
              </div>
            </div>
            {percent !== null ? (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">
                  Update wird installiert … {percent} %. Die App startet danach automatisch neu.
                </p>
                <Progress value={percent} className="mt-3" />
              </div>
            ) : null}
            {failed ? (
              <p className="mt-3 text-xs text-destructive">
                Update konnte nicht installiert werden. Bitte erneut versuchen.
              </p>
            ) : null}
            {update.body ? (
              <div className="mt-4 max-h-56 overflow-y-auto pr-1">
                <Markdown source={update.body} className="text-xs" />
              </div>
            ) : null}
            <p className="mt-4 text-xs text-muted-foreground">
              <Link
                to="/release-notes"
                className="underline underline-offset-3 hover:text-foreground"
                onClick={() => closeUpdatePrompt()}
              >
                Alle Release Notes
              </Link>
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

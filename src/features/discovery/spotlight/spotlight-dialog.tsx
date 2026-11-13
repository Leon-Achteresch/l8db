import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SpotlightCard } from "@/features/discovery/spotlight/spotlight-card";
import { releaseSurface } from "@/lib/discovery/coordinator";
import { highlightFeature } from "@/lib/discovery/highlight";
import type { SpotlightContent } from "@/lib/discovery/spotlight/model";
import { SPOTLIGHT_SURFACE_ID, useSpotlightStore } from "@/lib/discovery/spotlight/store";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SpotlightDialog({ content }: { content: SpotlightContent }) {
  const welcome = content.kind === "welcomeBack";
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>(
    welcome ? "discover.welcome-back" : "discover.spotlight",
  );
  const close = () => {
    useSpotlightStore.getState().close();
    releaseSurface(content.kind, SPOTLIGHT_SURFACE_ID);
  };
  const tryFeature = (id: string) => {
    close();
    void highlightFeature(id);
  };

  const total = content.major.length + content.others.reduce((sum, g) => sum + g.entries.length, 0);

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        ref={ref}
        data-discovery-spotlight={content.kind}
        className="max-h-[calc(100dvh-4rem)] gap-0 overflow-y-auto p-0 sm:max-w-4xl [&>[data-slot=dialog-close]]:text-white/80 [&>[data-slot=dialog-close]]:hover:text-white"
      >
        <header className="relative isolate overflow-hidden px-8 pt-10 pb-8 text-white">
          <div className="absolute inset-0 -z-10 bg-linear-to-br from-(--discovery-deep) via-(--discovery-2)/70 to-(--discovery-deep)" />
          <div className="absolute -top-24 -left-16 -z-10 size-80 rounded-full bg-(--discovery-1)/60 blur-3xl" />
          <div className="absolute -right-10 -bottom-32 -z-10 size-96 rounded-full bg-(--discovery-2)/45 blur-3xl" />
          <div className="absolute top-6 right-1/3 -z-10 size-48 rounded-full bg-(--discovery-3)/35 blur-3xl" />
          <div className="discovery-grain absolute inset-0 -z-10 opacity-50 mix-blend-overlay" />
          <p className="font-mono text-[10px] tracking-widest text-white/60 uppercase">
            {welcome ? "Willkommen zurück" : `Release ${content.label}`}
          </p>
          <DialogTitle className="mt-2 flex items-center gap-2 text-4xl font-semibold tracking-[-0.03em]">
            {welcome ? `Seit ${content.label} neu` : `Neu in ${content.label}`}
            {isNew && <NewBadge />}
          </DialogTitle>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 tabular-nums backdrop-blur">
            <span className="size-1.5 rounded-full bg-white" />
            {total} Neuerungen
          </p>
        </header>
        <div className="flex flex-col gap-8 p-6">
          {content.major.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {content.major.map((entry, index) => (
                <SpotlightCard key={entry.id} entry={entry} index={index} onTry={tryFeature} />
              ))}
            </div>
          )}
          {content.others.length > 0 && (
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {content.others.map((group) => (
                <section key={group.area} className="flex flex-col gap-2">
                  <h3 className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                    {group.area}
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {group.entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="h-7 cursor-pointer rounded-full bg-muted/50 px-3 text-xs transition-colors hover:bg-muted active:scale-[0.98]"
                        onClick={() => tryFeature(entry.id)}
                      >
                        {entry.title}
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="rounded-full" asChild>
              <Link to="/release-notes" onClick={close}>
                Alle Neuerungen
                <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

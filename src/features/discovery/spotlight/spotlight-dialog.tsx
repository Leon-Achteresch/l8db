import { Link } from "@tanstack/react-router";
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

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        ref={ref}
        data-discovery-spotlight={content.kind}
        className="max-h-[calc(100dvh-4rem)] gap-6 overflow-y-auto sm:max-w-4xl"
      >
        <DialogTitle className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          {welcome ? `Willkommen zurück – seit ${content.label} neu` : `Neu in ${content.label}`}
          {isNew && <NewBadge />}
        </DialogTitle>
        {content.major.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {content.major.map((entry) => (
              <SpotlightCard key={entry.id} entry={entry} onTry={tryFeature} />
            ))}
          </div>
        )}
        {content.others.length > 0 && (
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            {content.others.map((group) => (
              <section key={group.area} className="flex flex-col gap-1">
                <h3 className="text-xs font-medium text-muted-foreground">{group.area}</h3>
                {group.entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="-mx-2 cursor-pointer rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-muted/60 active:bg-muted"
                    onClick={() => tryFeature(entry.id)}
                  >
                    {entry.title}
                  </button>
                ))}
              </section>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/release-notes" onClick={close}>
              Alle Neuerungen
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

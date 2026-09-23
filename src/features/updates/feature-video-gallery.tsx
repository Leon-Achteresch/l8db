import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshFeatureVideos, useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useFeatureVideos } from "@/lib/feature-videos/use-feature-videos";

export function FeatureVideoGallery() {
  const { items } = useFeatureVideos();
  const { open, loading, error } = useFeatureVideoStore();
  return (
    <section className="mt-6" aria-label="Neue Features als Video">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Kurz gezeigt</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Entdecke die wichtigsten neuen Funktionen in wenigen Sekunden.
          </p>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => void refreshFeatureVideos(true)}
          disabled={loading}
          aria-label="Feature-Videos aktualisieren"
        >
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>
      {items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => open(item.id, true)}
              className="group rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {item.durationSeconds.toFixed(0)} Sekunden
                </span>
                <Play className="size-4 text-primary" />
              </div>
              <h3 className="text-sm font-medium">{item.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
            </button>
          ))}
        </div>
      ) : (
        <p
          role="status"
          className="rounded-xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground"
        >
          {loading
            ? "Feature-Videos werden geladen …"
            : error
              ? "Feature-Videos sind gerade nicht erreichbar. Alle Änderungen stehen unten."
              : "Für diese App-Version sind derzeit keine neuen Feature-Videos verfügbar."}
        </p>
      )}
    </section>
  );
}

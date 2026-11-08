import { ArrowUpRight, Lightbulb, RefreshCw, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { issueDraftUrl, issueUrl, openExternal } from "@/lib/discovery/labs/feedback";
import type { RoadmapStatus } from "@/lib/discovery/roadmap/model";
import {
  cachedRoadmap,
  nextManualRefresh,
  refreshRoadmap,
  useRoadmapStore,
} from "@/lib/discovery/roadmap/store";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const STATUS_LABELS: Record<RoadmapStatus, string> = {
  "in-arbeit": "In Arbeit",
  geplant: "Geplant",
  erschienen: "Erschienen",
};
const ORDER: RoadmapStatus[] = ["in-arbeit", "geplant", "erschienen"];

async function open(url: string) {
  if (!(await openExternal(url))) toast.error("Browser konnte nicht geöffnet werden");
}

function suggest() {
  void open(
    issueDraftUrl(
      "Wunsch: ",
      ["### Was möchtest du tun?", "", "", "### Warum?", ""].join("\n"),
      "enhancement",
    ),
  );
}

export function DiscoverRoadmapTab() {
  useRoadmapStore((state) => state.feed);
  const loading = useRoadmapStore((state) => state.loading);
  const error = useRoadmapStore((state) => state.error);
  const [cooldown, setCooldown] = useState(0);
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("discover.roadmap");
  const feed = cachedRoadmap();

  useEffect(() => {
    void refreshRoadmap();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(nextManualRefresh()), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const retry = () => {
    void refreshRoadmap(true).then(() => setCooldown(nextManualRefresh()));
  };

  return (
    <div ref={ref} className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          Roadmap
          {isNew && <NewBadge />}
        </h2>
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={retry}
            disabled={loading || cooldown > 0}
            aria-label="Aktualisieren"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          <Button size="sm" variant="secondary" onClick={suggest}>
            <Lightbulb />
            Wunsch einreichen
          </Button>
        </div>
      </div>

      {!feed || feed.items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {loading
              ? "Lädt …"
              : error === "rate-limit"
                ? "GitHub-Limit erreicht"
                : error === "offline"
                  ? "Offline"
                  : error
                    ? "Roadmap nicht verfügbar"
                    : "Noch keine Einträge"}
          </p>
          {!loading && error && error !== "missing" && (
            <Button size="sm" variant="ghost" onClick={retry} disabled={cooldown > 0}>
              <RefreshCw />
              Erneut versuchen
            </Button>
          )}
        </div>
      ) : (
        ORDER.map((status) => {
          const items = feed.items.filter((item) => item.status === status);
          if (!items.length) return null;
          return (
            <section key={status} className="space-y-2">
              <h3 className="text-xs font-medium text-muted-foreground">{STATUS_LABELS[status]}</h3>
              <ul className="grid gap-2 sm:grid-cols-2">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-col gap-2 rounded-xl bg-muted/40 p-4"
                    data-roadmap-item={item.id}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      {item.eta && (
                        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                          {item.eta}
                        </span>
                      )}
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">{item.summary}</p>
                    {item.issue !== undefined && (
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => void open(issueUrl(item.issue as number))}
                        >
                          <ThumbsUp />
                          Abstimmen
                          <ArrowUpRight className="size-3" />
                        </Button>
                        {item.votes !== undefined && (
                          <span className="text-[11px] tabular-nums text-muted-foreground">
                            {item.votes}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

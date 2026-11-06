import { GlobeIcon } from "lucide-react";
import gt from "semver/functions/gt";
import valid from "semver/functions/valid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { UiPluginCatalogEntry } from "@/lib/ui-plugins/catalog";
import type { InstalledUiPlugin } from "@/lib/ui-plugins/settings";
import { CatalogScreenshot } from "./catalog-screenshot";

export function UiPluginGalleryCard({
  entry,
  installed,
  pending,
  onInstall,
}: {
  entry: UiPluginCatalogEntry;
  installed: InstalledUiPlugin | undefined;
  pending: boolean;
  onInstall: () => void;
}) {
  const update =
    installed !== undefined &&
    (installed.sha256 !== entry.sha256 ||
      (!!valid(entry.version) &&
        !!valid(installed.version) &&
        gt(entry.version, installed.version)));
  return (
    <article
      aria-label={entry.name}
      className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border/80 bg-card p-3 shadow-xs"
    >
      <CatalogScreenshot entry={entry} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm font-semibold">{entry.name}</strong>
          <span className="text-xs text-muted-foreground tabular-nums">v{entry.version}</span>
          {entry.author && (
            <span className="text-xs text-muted-foreground">von {entry.author}</span>
          )}
        </div>
        {entry.description && (
          <p className="text-xs text-pretty text-muted-foreground">{entry.description}</p>
        )}
        <div className="flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px]">
              {tag}
            </Badge>
          ))}
          {entry.http.length > 0 && (
            <Badge variant="outline" className="gap-1 text-[10px]" title={entry.http.join(", ")}>
              <GlobeIcon className="size-3" />
              Netzwerk
            </Badge>
          )}
        </div>
      </div>
      <Button
        size="sm"
        variant={installed && !update ? "ghost" : "default"}
        disabled={pending || (installed !== undefined && !update)}
        onClick={onInstall}
      >
        {pending && <Spinner />}
        {pending ? "Lädt …" : update ? "Aktualisieren" : installed ? "Installiert" : "Installieren"}
      </Button>
    </article>
  );
}

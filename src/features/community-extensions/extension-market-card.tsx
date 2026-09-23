import { gt } from "semver";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ExtensionDescriptor } from "@/lib/extensions/contracts";
import type { MarketExtension } from "@/lib/extensions/market";

export function ExtensionMarketCard({
  entry,
  installed,
  pending,
  onInstall,
}: {
  entry: MarketExtension;
  installed?: ExtensionDescriptor;
  pending: boolean;
  onInstall: () => void;
}) {
  const updateAvailable =
    installed !== undefined && gt(entry.version, installed.archive.manifest.version);
  return (
    <article className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-sm">{entry.name}</strong>
          <Badge variant="outline">Offiziell</Badge>
          <span className="text-xs text-muted-foreground">v{entry.version}</span>
        </div>
        <p className="text-sm text-muted-foreground">{entry.description}</p>
        <p className="font-mono text-xs text-muted-foreground">{entry.id}</p>
      </div>
      <Button
        size="sm"
        variant={installed && !updateAvailable ? "outline" : "default"}
        disabled={pending || (installed !== undefined && !updateAvailable)}
        onClick={onInstall}
      >
        {pending
          ? "Lädt…"
          : updateAvailable
            ? "Aktualisieren"
            : installed
              ? "Installiert"
              : "Installieren"}
      </Button>
    </article>
  );
}

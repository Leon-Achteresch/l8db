import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  COMMUNITY_MARKET_REPOSITORY,
  COMMUNITY_MARKET_URL,
  downloadMarketExtension,
  loadMarketCatalog,
  type MarketCatalog,
  type MarketExtension,
  OFFICIAL_MARKET_URL,
} from "@/lib/extensions/market";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { ExtensionMarketCard } from "./extension-market-card";

export function ExtensionMarketSection({ community = false }: { community?: boolean }) {
  const catalogUrl = community ? COMMUNITY_MARKET_URL : OFFICIAL_MARKET_URL;
  const headingId = useId();
  const feature = useNewFeatureVisibility<HTMLElement>(
    community ? "settings.extensions.community-market" : undefined,
  );
  const host = useExtensionHost();
  const installed = useExtensionSnapshot((manager) => manager.listExtensions());
  const [catalog, setCatalog] = useState<MarketCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await loadMarketCatalog(fetch, catalogUrl));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [catalogUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (entry: MarketExtension) => {
    if (pending) return;
    setPending(entry.id);
    try {
      const archive = await downloadMarketExtension(entry, fetch, catalogUrl);
      if (installed.some((item) => item.archive.manifest.id === entry.id))
        await host.updateExtension(archive);
      else await host.installExtension(archive);
      toast.success(`${entry.name} installiert. Jetzt unter „Installiert“ aktivieren.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <section ref={feature.ref} className="space-y-3" aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold">
            {community ? "Community" : "Entdecken"}
            {feature.isNew && <NewBadge />}
          </h3>
          <p className="text-xs text-pretty text-muted-foreground">
            {community
              ? "Von der Community per Pull Request eingereicht und nicht von l8db entwickelt. Prüfe Herausgeber und Berechtigungen vor dem Aktivieren."
              : "Offizielle Erweiterungen, vor der Installation per SHA-256 geprüft."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {community && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openUrl(COMMUNITY_MARKET_REPOSITORY)}
            >
              Einreichen
              <ExternalLinkIcon />
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Katalog aktualisieren"
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </Button>
        </div>
      </div>
      {loading && !catalog && (
        <p className="text-xs text-muted-foreground">Katalog wird geladen …</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Katalog nicht verfügbar: {error}
        </p>
      )}
      {catalog && (
        <div className="space-y-3">
          {catalog.extensions.map((entry) => (
            <ExtensionMarketCard
              key={entry.id}
              entry={entry}
              community={community}
              installed={installed.find((item) => item.archive.manifest.id === entry.id)}
              pending={pending === entry.id}
              onInstall={() => void install(entry)}
            />
          ))}
          {catalog.extensions.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Der Katalog enthält noch keine Erweiterungen.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

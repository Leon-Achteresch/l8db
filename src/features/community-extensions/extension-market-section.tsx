import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  downloadMarketExtension,
  loadMarketCatalog,
  type MarketCatalog,
  type MarketExtension,
} from "@/lib/extensions/market";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";
import { ExtensionMarketCard } from "./extension-market-card";

export function ExtensionMarketSection() {
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
      setCatalog(await loadMarketCatalog());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const install = async (entry: MarketExtension) => {
    if (pending) return;
    setPending(entry.id);
    try {
      const archive = await downloadMarketExtension(entry);
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
    <section className="space-y-3" aria-labelledby="extension-market">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="extension-market" className="text-sm font-semibold">
            Entdecken
          </h3>
          <p className="text-xs text-muted-foreground">
            Offizielle Erweiterungen, vor der Installation per SHA-256 geprüft.
          </p>
        </div>
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

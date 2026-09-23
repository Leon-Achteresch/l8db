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
      toast.success(`${entry.name} installiert. Berechtigungen unten prüfen und aktivieren.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  return (
    <section className="space-y-4" aria-label="Extension-Markt">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Extension-Markt</h2>
          <p className="text-sm text-muted-foreground">
            Offiziell unterstützte Extensions aus dem öffentlichen l8db-Katalog. Pakete werden vor
            der Installation mit SHA-256 geprüft und zunächst deaktiviert installiert.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
          <RefreshCwIcon className="size-4" />
          Aktualisieren
        </Button>
      </div>
      {loading && !catalog && (
        <p className="text-sm text-muted-foreground">Katalog wird geladen…</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
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
            <p className="text-sm text-muted-foreground">
              Der Katalog enthält noch keine Extensions.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

import { ArrowLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CommunityExtensionCard } from "@/features/community-extensions/community-extension-card";
import { errorText } from "@/features/community-extensions/password-manager";
import { OnboardingExtensionCard } from "@/features/onboarding/onboarding-extension-card";
import {
  downloadMarketExtension,
  loadMarketCatalog,
  type MarketExtension,
} from "@/lib/extensions/market";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";

export function OnboardingExtensions() {
  const host = useExtensionHost();
  const extensions = useExtensionSnapshot((manager) => manager.listExtensions());
  const [entries, setEntries] = useState<MarketExtension[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const current = extensions.find((item) => item.archive.manifest.id === open);

  useEffect(() => {
    let alive = true;
    loadMarketCatalog()
      .then((catalog) => alive && setEntries(catalog.extensions))
      .catch((cause) => alive && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      alive = false;
    };
  }, []);

  const install = async (entry: MarketExtension) => {
    if (pending) return;
    setPending(entry.id);
    try {
      await host.installExtension(await downloadMarketExtension(entry));
      toast.success(`${entry.name} installiert.`);
      setOpen(entry.id);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  const run = (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    void Promise.resolve()
      .then(action)
      .catch((cause) => toast.error(errorText(cause)))
      .finally(() => setBusy(false));
  };

  if (current)
    return (
      <div className="@container mt-8 space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setOpen(null)}>
          <ArrowLeftIcon />
          Alle Erweiterungen
        </Button>
        <fieldset disabled={busy} className="min-w-0">
          <CommunityExtensionCard extension={current} run={run} />
        </fieldset>
      </div>
    );

  if (error)
    return (
      <p className="mt-8 rounded-2xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Der Marketplace ist gerade nicht erreichbar. Du findest alle Erweiterungen später unter
        Einstellungen → Erweiterungen.
      </p>
    );

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2">
      {entries
        ? entries.map((entry, index) => (
            <OnboardingExtensionCard
              key={entry.id}
              entry={entry}
              index={index}
              installed={extensions.some((item) => item.archive.manifest.id === entry.id)}
              pending={pending === entry.id}
              onInstall={() => void install(entry)}
              onSetup={() => setOpen(entry.id)}
            />
          ))
        : [0, 1].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />)}
    </div>
  );
}

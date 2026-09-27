import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { OnboardingExtensionCard } from "@/features/onboarding/onboarding-extension-card";
import {
  downloadMarketExtension,
  loadMarketCatalog,
  type MarketExtension,
} from "@/lib/extensions/market";
import { useExtensionHost, useExtensionSnapshot } from "@/lib/extensions/react-context";

interface OnboardingExtensionsProps {
  onFinish: () => void;
}

export function OnboardingExtensions({ onFinish }: OnboardingExtensionsProps) {
  const host = useExtensionHost();
  const navigate = useNavigate();
  const installed = useExtensionSnapshot((manager) =>
    manager.listExtensions().map((item) => item.archive.manifest.id),
  );
  const [entries, setEntries] = useState<MarketExtension[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

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
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  };

  const setup = () => {
    onFinish();
    void navigate({ to: "/settings", search: { tab: "extensions" } });
  };

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
              installed={installed.includes(entry.id)}
              pending={pending === entry.id}
              onInstall={() => void install(entry)}
              onSetup={setup}
            />
          ))
        : [0, 1].map((i) => <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />)}
    </div>
  );
}

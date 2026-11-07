import { useQuery } from "@tanstack/react-query";
import { Cloud, Plus } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CLOUD_QUERY_OPTIONS, type CloudAccount, cloudAccounts } from "@/lib/db/cloud-accounts";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { CloudAccountAddDialog } from "./cloud-account-add-dialog";
import { CloudAccountRemoveButton } from "./cloud-account-remove-button";
import { CloudSectionError } from "./cloud-section-error";
import { NeonAccountExplorer } from "./neon-account-explorer";
import { PlanetScaleAccountExplorer } from "./planetscale-account-explorer";
import { SpacetimeAccountExplorer } from "./spacetime-account-explorer";

const PROVIDER_LABEL: Record<CloudAccount["provider"], string> = {
  neon: "Neon",
  planetscale: "PlanetScale",
  spacetimedb: "SpacetimeDB",
};

const AUTH_LABEL: Record<CloudAccount["auth"], string> = {
  api_key: "API-Schlüssel",
  oauth: "OAuth",
  service_token: "Service-Token",
  token: "Token",
};

export function CloudAccountsView() {
  const feature = useNewFeatureVisibility<HTMLElement>("connections.cloud-accounts");
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const accounts = useQuery({
    queryKey: ["cloud-accounts", "list"],
    queryFn: cloudAccounts,
    ...CLOUD_QUERY_OPTIONS,
  });
  const list = accounts.data ?? [];
  const selected = list.find((account) => account.id === selectedId) ?? list[0] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-6">
      <header ref={feature.ref} className="flex flex-wrap items-center gap-3">
        <Cloud className="size-5" />
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Cloud-Konten {feature.isNew && <NewBadge />}</h1>
          <p className="text-sm text-muted-foreground">
            Neon, PlanetScale und SpacetimeDB verbinden, Datenbanken auswählen und als Verbindungen
            anlegen.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" />
          Konto hinzufügen
        </Button>
      </header>
      {accounts.isError && (
        <CloudSectionError error={accounts.error} onRetry={() => void accounts.refetch()} />
      )}
      {accounts.isSuccess && list.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Cloud />
            </EmptyMedia>
            <EmptyTitle>Noch kein Cloud-Konto</EmptyTitle>
            <EmptyDescription>
              Füge einen Neon-API-Schlüssel, ein PlanetScale-Service-Token oder ein
              SpacetimeDB-Token hinzu.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setAdding(true)}>
              Konto hinzufügen
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map((account) => (
            <Button
              key={account.id}
              size="sm"
              variant={selected?.id === account.id ? "secondary" : "outline"}
              onClick={() => setSelectedId(account.id)}
            >
              {account.label}
              <Badge variant="outline">{PROVIDER_LABEL[account.provider]}</Badge>
            </Button>
          ))}
        </div>
      )}
      {selected && (
        <section className="flex flex-col gap-4 rounded-lg border p-4" key={selected.id}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium">{selected.label}</h2>
            <Badge variant="secondary">{PROVIDER_LABEL[selected.provider]}</Badge>
            <Badge variant="outline">{AUTH_LABEL[selected.auth]}</Badge>
            {selected.endpoint && <Badge variant="outline">Lokal: {selected.endpoint}</Badge>}
            <span className="ml-auto">
              <CloudAccountRemoveButton account={selected} onRemoved={() => setSelectedId(null)} />
            </span>
          </div>
          {selected.provider === "neon" && <NeonAccountExplorer accountId={selected.id} />}
          {selected.provider === "planetscale" && (
            <PlanetScaleAccountExplorer accountId={selected.id} />
          )}
          {selected.provider === "spacetimedb" && <SpacetimeAccountExplorer account={selected} />}
        </section>
      )}
      <CloudAccountAddDialog
        open={adding}
        onOpenChange={setAdding}
        onAdded={(account) => setSelectedId(account.id)}
      />
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Cloud, Plus } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
    <div className="flex h-full min-h-0 w-full flex-col gap-4 overflow-auto p-4 md:p-6">
      <header ref={feature.ref} className="flex min-h-9 items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          Cloud-Konten {feature.isNew && <NewBadge />}
        </h1>
        {list.length > 0 && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            Konto hinzufügen
          </Button>
        )}
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
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              {Object.values(PROVIDER_LABEL).join(" · ")}
            </p>
          </EmptyHeader>
          <EmptyContent>
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              Konto hinzufügen
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {list.map((account) => (
            <Button
              key={account.id}
              size="sm"
              variant={selected?.id === account.id ? "secondary" : "ghost"}
              aria-pressed={selected?.id === account.id}
              onClick={() => setSelectedId(account.id)}
            >
              {account.label}
              <span className="text-xs font-normal text-muted-foreground">
                {PROVIDER_LABEL[account.provider]}
              </span>
            </Button>
          ))}
        </div>
      )}
      {selected && (
        <section className="flex flex-col gap-4 rounded-xl bg-muted/40 p-4" key={selected.id}>
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

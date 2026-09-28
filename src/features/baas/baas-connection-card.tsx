import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Cloud, Play, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { BAAS_PROVIDERS } from "./baas-providers";
import { disconnectBaas } from "./disconnect-baas";
import type { BaasConnection } from "./use-baas-connections";

export function BaasConnectionCard({ connection }: { connection: BaasConnection }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const providerName = BAAS_PROVIDERS.find((item) => item.id === connection.provider)?.name;

  function open() {
    void navigate({ to: "/baas", search: { provider: connection.provider, id: connection.id } });
  }

  async function remove() {
    setBusy(true);
    try {
      await disconnectBaas(connection);
      await queryClient.invalidateQueries({ queryKey: [connection.provider] });
    } catch (reason) {
      toast.error(String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      onDoubleClick={open}
      className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border/80 bg-card p-4 transition-all duration-200 hover:border-foreground/25 hover:shadow-md"
    >
      <div>
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg border bg-background/80 shadow-2xs transition-transform group-hover:scale-105">
            <ProviderLogo providerId={connection.provider} className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3
              className="truncate text-sm font-semibold tracking-tight text-foreground"
              title={connection.name}
            >
              {connection.name}
            </h3>
            <p className="truncate text-[11px] text-muted-foreground">{providerName}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-border/50 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
          <Cloud className="size-3 shrink-0 text-muted-foreground/70" />
          <span className="truncate font-mono font-medium text-foreground/90">
            {connection.detail}
          </span>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/40 pt-3">
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => void remove()}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3" />
          Löschen
        </Button>
        <Button variant="default" size="xs" onClick={open} className="gap-1 shadow-2xs">
          <Play className="size-3" />
          Öffnen
        </Button>
      </div>
    </article>
  );
}

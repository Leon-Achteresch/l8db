import { Link } from "@tanstack/react-router";
import { Cloud } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { BAAS_PROVIDERS } from "@/features/baas/baas-providers";

export function BaasOptions() {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Cloud className="size-3" />
        Backend-as-a-Service
      </p>
      <div className="flex flex-wrap gap-1.5">
        {BAAS_PROVIDERS.map((provider) => (
          <Link
            key={provider.id}
            to="/baas"
            search={{ provider: provider.id }}
            className="flex h-8 items-center gap-1.5 rounded-full border bg-card pr-3 pl-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background ring-1 ring-border/70">
              <ProviderLogo providerId={provider.id} className="size-3.5" />
            </span>
            {provider.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

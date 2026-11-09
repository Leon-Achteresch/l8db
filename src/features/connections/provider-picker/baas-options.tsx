import { NewBadge } from "@/components/new-badge";
import { ProviderLogo } from "@/components/provider-logo";
import {
  BAAS_AS_DATABASE,
  BAAS_PROVIDERS,
  type BaasProvider,
} from "@/features/baas/baas-providers";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function BaasOptions({ onSelect }: { onSelect: (provider: BaasProvider) => void }) {
  const feature = useNewFeatureVisibility<HTMLParagraphElement>("connections.baas");
  return (
    <div className="space-y-1.5">
      <p
        ref={feature.ref}
        className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase"
      >
        Backend-as-a-Service
        {feature.isNew && <NewBadge />}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {BAAS_PROVIDERS.filter(
          (provider) => !BAAS_AS_DATABASE.some((item) => item.id === provider.id),
        ).map((provider) => (
          <button
            key={provider.id}
            type="button"
            onClick={() => onSelect(provider.id)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-muted/50 pr-3 pl-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background ring-1 ring-border/70">
              <ProviderLogo providerId={provider.id} className="size-3.5" />
            </span>
            {provider.name}
          </button>
        ))}
      </div>
    </div>
  );
}

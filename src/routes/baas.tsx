import { createFileRoute } from "@tanstack/react-router";
import { BAAS_PROVIDERS, type BaasProvider } from "@/features/baas/baas-providers";
import { BaasView } from "@/features/baas/baas-view";

export const Route = createFileRoute("/baas")({
  validateSearch: (search: Record<string, unknown>): { provider: BaasProvider } => ({
    provider: BAAS_PROVIDERS.some((item) => item.id === search.provider)
      ? (search.provider as BaasProvider)
      : "supabase",
  }),
  component: BaasView,
});

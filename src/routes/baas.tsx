import { createFileRoute } from "@tanstack/react-router";
import { BAAS_PROVIDERS, type BaasProvider } from "@/features/baas/baas-providers";
import { type BaasSection, SECTION_INFO } from "@/features/baas/baas-sections";
import { BaasView } from "@/features/baas/baas-view";

export const Route = createFileRoute("/baas")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { provider: BaasProvider; id?: string; section?: BaasSection } => ({
    provider: BAAS_PROVIDERS.some((item) => item.id === search.provider)
      ? (search.provider as BaasProvider)
      : "supabase",
    id: typeof search.id === "string" ? search.id : undefined,
    section:
      typeof search.section === "string" && search.section in SECTION_INFO
        ? (search.section as BaasSection)
        : undefined,
  }),
  component: BaasView,
});

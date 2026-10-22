import { createFileRoute } from "@tanstack/react-router";
import { BAAS_PROVIDERS, type BaasProvider } from "@/features/baas/baas-providers";
import { type BaasSection, SECTION_INFO } from "@/features/baas/baas-sections";
import { BaasView } from "@/features/baas/baas-view";

export const Route = createFileRoute("/baas")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    provider: BaasProvider;
    id?: string;
    section?: BaasSection;
    studio?: string;
    project?: number;
    deployment?: string;
  } => ({
    provider: BAAS_PROVIDERS.some((item) => item.id === search.provider)
      ? (search.provider as BaasProvider)
      : "supabase",
    id: typeof search.id === "string" ? search.id : undefined,
    section:
      typeof search.section === "string" && search.section in SECTION_INFO
        ? (search.section as BaasSection)
        : undefined,
    studio: typeof search.studio === "string" ? search.studio : undefined,
    project:
      typeof search.project === "number" && Number.isSafeInteger(search.project)
        ? search.project
        : undefined,
    deployment: typeof search.deployment === "string" ? search.deployment : undefined,
  }),
  component: BaasView,
});

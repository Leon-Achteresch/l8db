import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { type SupabaseProject, supabaseStudioCapabilities } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasStudioFrame } from "../baas-studio-frame";
import { SUPABASE_STUDIO_SECTIONS } from "./supabase-studio-sections";

const route = getRouteApi("/baas");

export function SupabaseStudio({
  project,
  header,
  footer,
}: {
  project: SupabaseProject;
  header: ReactNode;
  footer: ReactNode;
}) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLElement>("baas.supabase.studio");
  const capabilities = useQuery({
    queryKey: ["supabase", project.reference, "studio-capabilities"],
    queryFn: () => supabaseStudioCapabilities(project.reference),
  });
  const active =
    SUPABASE_STUDIO_SECTIONS.find(
      (section) =>
        section.id === search.studio &&
        capabilities.data &&
        !section.unavailable(capabilities.data),
    ) ?? SUPABASE_STUDIO_SECTIONS[0];
  const Section = active.component;

  return (
    <BaasStudioFrame
      label="Supabase Studio"
      navRef={feature.ref}
      isNew={feature.isNew}
      header={header}
      footer={footer}
      details={
        <dl className="space-y-1 px-2 text-xs">
          <dt className="text-muted-foreground">
            {project.self_hosted ? "Projekt-URL" : "Region"}
          </dt>
          <dd
            className="truncate font-mono"
            title={(project.self_hosted ? project.api_url : project.region) ?? undefined}
          >
            {(project.self_hosted ? project.api_url : project.region) ?? "–"}
          </dd>
          <dt className="pt-1 text-muted-foreground">Schlüssel</dt>
          <dd>
            {!project.self_hosted
              ? "Zugangstoken"
              : project.secret_key
                ? "Secret Key"
                : "Publishable Key"}
          </dd>
        </dl>
      }
      tabs={SUPABASE_STUDIO_SECTIONS.map((section) => ({
        value: section.id,
        label: section.label,
        icon: section.icon,
        featureScope: `baas.supabase.studio.${section.id}`,
        disabledReason: capabilities.data
          ? section.unavailable(capabilities.data)
          : capabilities.isError
            ? "Studio konnte nicht geladen werden."
            : "Studio wird geladen…",
      }))}
      value={active.id}
      onValueChange={async (id) => {
        await navigate({ to: "/baas", search: { ...search, studio: id } });
      }}
    >
      {capabilities.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {String(capabilities.error)}
        </p>
      ) : capabilities.data ? (
        <Section
          key={`${project.reference}:${active.id}`}
          project={project}
          capabilities={capabilities.data}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Studio wird geladen…</p>
      )}
    </BaasStudioFrame>
  );
}

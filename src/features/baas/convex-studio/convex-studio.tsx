import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasStudioFrame } from "../baas-studio-frame";
import { CONVEX_STUDIO_SECTIONS, type ConvexStudioDeployment } from "./convex-studio-sections";

const route = getRouteApi("/baas");

export function ConvexStudio({
  deployment,
  header,
  footer,
}: {
  deployment: ConvexStudioDeployment;
  header: ReactNode;
  footer: ReactNode;
}) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLElement>("baas.convex.studio");
  const active =
    CONVEX_STUDIO_SECTIONS.find((section) => section.id === search.studio) ??
    CONVEX_STUDIO_SECTIONS[0];
  const Section = active.component;

  return (
    <BaasStudioFrame
      label="Convex Studio"
      navRef={feature.ref}
      isNew={feature.isNew}
      header={header}
      footer={footer}
      details={
        <dl className="space-y-1 px-2 text-xs">
          <dt className="text-muted-foreground">Deployment</dt>
          <dd className="truncate font-mono" title={deployment.title}>
            {deployment.title}
          </dd>
          <dt className="pt-1 text-muted-foreground">Betrieb</dt>
          <dd>{deployment.selfHosted ? "Selbst gehostet" : "Convex Cloud"}</dd>
        </dl>
      }
      tabs={CONVEX_STUDIO_SECTIONS.map((section) => ({
        value: section.id,
        label: section.label,
        icon: section.icon,
        featureScope: `baas.convex.studio.${section.id}`,
      }))}
      value={active.id}
      onValueChange={async (id) => {
        await navigate({ to: "/baas", search: { ...search, studio: id } });
      }}
    >
      <Section
        key={`${deployment.profileId}:${deployment.deploymentName}:${active.id}`}
        deployment={deployment}
      />
    </BaasStudioFrame>
  );
}

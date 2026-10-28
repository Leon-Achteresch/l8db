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
      details={`${deployment.title} · ${deployment.selfHosted ? "Selbst gehostet" : "Convex Cloud"}`}
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
      <div
        className={
          active.fullBleed ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-auto p-5"
        }
      >
        <Section
          key={`${deployment.profileId}:${deployment.deploymentName}:${active.id}`}
          deployment={deployment}
        />
      </div>
    </BaasStudioFrame>
  );
}

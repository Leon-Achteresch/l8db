import { useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { convexDataTables } from "@/lib/db/convex-studio-data";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasStudioFrame } from "../baas-studio-frame";
import { CONVEX_STUDIO_SECTIONS, type ConvexStudioDeployment } from "./convex-studio-sections";
import { dataKey, tableScope } from "./data/convex-data-utils";

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
  const queryClient = useQueryClient();
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
      fullBleed={active.fullBleed}
      paletteKey={`convex:${tableScope(deployment)}`}
      paletteTables={{
        load: async () =>
          (
            await queryClient.fetchQuery({
              queryKey: [...dataKey(deployment), "tables"],
              queryFn: () => convexDataTables(deployment),
              staleTime: 30_000,
            })
          ).tables.map((table) => ({ name: table.name })),
        open: (table) =>
          navigate({
            to: "/baas",
            search: {
              ...search,
              studio: "data",
              table: table.name,
              tableProject: tableScope(deployment),
            },
          }),
      }}
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

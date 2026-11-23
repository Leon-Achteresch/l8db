import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { convexDeployments } from "@/lib/db";
import { convexDataTables } from "@/lib/db/convex-studio-data";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasSidebarPortal } from "../baas-sidebar-portal";
import { BaasStudioFrame } from "../baas-studio-frame";
import { CONVEX_STUDIO_SECTIONS, type ConvexStudioDeployment } from "./convex-studio-sections";
import { ConvexDataTableList } from "./data/convex-data-table-list";
import { dataKey, tableScope } from "./data/convex-data-utils";

const route = getRouteApi("/baas");
const ENVIRONMENTS: Record<string, { label: string; className: string }> = {
  prod: { label: "Produktion", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  dev: {
    label: "Entwicklung",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  preview: { label: "Preview", className: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
};

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
  const deployments = useQuery({
    queryKey: ["convex", deployment.profileId, "deployments", deployment.projectId],
    queryFn: () => convexDeployments(deployment.profileId, deployment.projectId),
    enabled: !deployment.selfHosted,
    staleTime: 60_000,
  });
  const environment =
    ENVIRONMENTS[
      deployments.data?.find((item) => item.name === deployment.deploymentName)?.deploymentType ??
        ""
    ];
  const ownSidebar = active.id === "data" || active.id === "functions";
  const openTable = (table: string) =>
    navigate({
      to: "/baas",
      search: { ...search, studio: "data", table, tableProject: tableScope(deployment) },
    });

  return (
    <BaasStudioFrame
      label="Convex Studio"
      navRef={feature.ref}
      isNew={feature.isNew}
      header={header}
      footer={footer}
      details={
        <>
          {deployment.title}
          {environment ? (
            <span
              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${environment.className}`}
            >
              {environment.label}
            </span>
          ) : (
            ` · ${deployment.selfHosted ? "Selbst gehostet" : "Convex Cloud"}`
          )}
        </>
      }
      tabs={CONVEX_STUDIO_SECTIONS.map((section) => ({
        value: section.id,
        label: section.label,
        icon: section.icon,
        featureScope: `baas.convex.studio.${section.id}`,
      }))}
      value={active.id}
      fullBleed={active.fullBleed}
      sidebarLabel={ownSidebar ? undefined : "Tabellen"}
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
        open: (table) => openTable(table.name),
      }}
      onValueChange={async (id) => {
        await navigate({ to: "/baas", search: { ...search, studio: id } });
      }}
    >
      {!ownSidebar && (
        <BaasSidebarPortal>
          <ConvexDataTableList
            deployment={deployment}
            selected={null}
            onSelect={(table) => void openTable(table)}
          />
        </BaasSidebarPortal>
      )}
      <Section
        key={`${deployment.profileId}:${deployment.deploymentName}:${active.id}`}
        deployment={deployment}
      />
    </BaasStudioFrame>
  );
}

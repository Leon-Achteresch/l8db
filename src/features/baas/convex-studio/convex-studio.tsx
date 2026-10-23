import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { CONVEX_STUDIO_SECTIONS, type ConvexStudioDeployment } from "./convex-studio-sections";

const route = getRouteApi("/baas");

export function ConvexStudio({
  deployment,
  header,
}: {
  deployment: ConvexStudioDeployment;
  header: ReactNode;
}) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLElement>("baas.convex.studio");
  const seenFeatures = useSeenNewFeatures();
  const active =
    CONVEX_STUDIO_SECTIONS.find((section) => section.id === search.studio) ??
    CONVEX_STUDIO_SECTIONS[0];
  const groups = [...new Set(CONVEX_STUDIO_SECTIONS.map((section) => section.group))];
  const Section = active.component;

  return (
    <div data-baas-studio className="flex h-full min-h-0">
      <nav
        ref={feature.ref}
        aria-label="Convex Studio"
        className="w-60 shrink-0 overflow-y-auto border-r bg-sidebar p-3"
      >
        {header}
        <div className="mb-3 flex items-center gap-2 px-2">
          <p className="truncate text-sm font-semibold" title={deployment.title}>
            {deployment.title}
          </p>
          {feature.isNew && <NewBadge />}
        </div>
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {group}
            </p>
            {CONVEX_STUDIO_SECTIONS.filter((section) => section.group === group).map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={active.id === section.id ? "page" : undefined}
                  onClick={() =>
                    void navigate({ to: "/baas", search: { ...search, studio: section.id } })
                  }
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${active.id === section.id ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{section.label}</span>
                  {hasNewFeatures(`baas.convex.studio.${section.id}`, seenFeatures) && <NewBadge />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <section aria-label={active.label} className="min-h-0 min-w-0 flex-1 overflow-auto p-5">
        <Section
          key={`${deployment.profileId}:${deployment.deploymentName}:${active.id}`}
          deployment={deployment}
        />
      </section>
    </div>
  );
}

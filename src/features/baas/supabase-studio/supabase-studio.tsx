import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { NewBadge } from "@/components/new-badge";
import { type SupabaseProject, supabaseStudioCapabilities } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { SUPABASE_STUDIO_SECTIONS } from "./supabase-studio-sections";

const route = getRouteApi("/baas");

export function SupabaseStudio({
  project,
  header,
}: {
  project: SupabaseProject;
  header: ReactNode;
}) {
  const search = route.useSearch();
  const navigate = useNavigate();
  const feature = useNewFeatureVisibility<HTMLElement>("baas.supabase.studio");
  const seenFeatures = useSeenNewFeatures();
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
  const groups = [...new Set(SUPABASE_STUDIO_SECTIONS.map((section) => section.group))];
  const Section = active.component;

  return (
    <div data-baas-studio className="flex h-full min-h-0">
      <nav
        ref={feature.ref}
        aria-label="Supabase Studio"
        className="w-60 shrink-0 overflow-y-auto border-r bg-sidebar p-3"
      >
        {header}
        {feature.isNew && (
          <div className="mb-3 px-2">
            <NewBadge />
          </div>
        )}
        {groups.map((group) => (
          <div key={group} className="mb-3">
            <p className="px-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {group}
            </p>
            {SUPABASE_STUDIO_SECTIONS.filter((section) => section.group === group).map(
              (section) => {
                const reason = capabilities.data ? section.unavailable(capabilities.data) : null;
                const Icon = section.icon;
                return (
                  <button
                    key={section.id}
                    type="button"
                    aria-current={active.id === section.id ? "page" : undefined}
                    disabled={!capabilities.data || Boolean(reason)}
                    title={reason ?? undefined}
                    onClick={() =>
                      void navigate({
                        to: "/baas",
                        search: { ...search, studio: section.id },
                      })
                    }
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active.id === section.id ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{section.label}</span>
                    {hasNewFeatures(`baas.supabase.studio.${section.id}`, seenFeatures) && (
                      <NewBadge />
                    )}
                  </button>
                );
              },
            )}
          </div>
        ))}
      </nav>
      <section aria-label={active.label} className="min-h-0 min-w-0 flex-1 overflow-auto p-5">
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
      </section>
    </div>
  );
}

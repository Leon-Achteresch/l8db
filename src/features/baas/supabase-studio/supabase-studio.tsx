import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { NewBadge } from "@/components/new-badge";
import { type SupabaseProject, supabaseStudioCapabilities } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { SUPABASE_STUDIO_SECTIONS } from "./supabase-studio-sections";

const route = getRouteApi("/baas");

export function SupabaseStudio({ project }: { project: SupabaseProject }) {
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
    <div className="grid min-h-[70vh] overflow-hidden rounded-2xl border bg-card md:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        ref={feature.ref}
        aria-label="Supabase Studio"
        className="border-b bg-muted/30 p-3 md:border-r md:border-b-0"
      >
        <div className="mb-3 flex items-center gap-2 px-2">
          <p className="truncate text-sm font-semibold">{project.name}</p>
          {feature.isNew && <NewBadge />}
        </div>
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
      <section aria-label={active.label} className="min-w-0 p-5">
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

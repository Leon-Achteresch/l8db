import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { BaasConnectionCard } from "@/features/baas/baas-connection-card";
import type { BaasConnection } from "@/features/baas/use-baas-connections";
import type { SavedConnection } from "@/lib/connections/types";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const PAGE_SIZE = 24;

export function CloudProjectCards({
  projects,
  databaseByProject,
  onEditDatabase,
}: {
  projects: BaasConnection[];
  databaseByProject: ReadonlyMap<BaasConnection, SavedConnection>;
  onEditDatabase: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const last = Math.max(0, Math.ceil(projects.length / PAGE_SIZE) - 1);
  const current = Math.min(page, last);
  const offset = current * PAGE_SIZE;
  const end = Math.min(offset + PAGE_SIZE, projects.length);
  const feature = useNewFeatureVisibility<HTMLElement>("connections.baas.project-pages");
  return (
    <>
      {last > 0 && (
        <nav
          ref={feature.ref}
          aria-label="Cloud-Projekte durchblättern"
          className="col-span-full flex items-center justify-end gap-2 text-xs text-muted-foreground"
        >
          {feature.isNew && <NewBadge />}
          <span aria-live="polite" className="tabular-nums">
            {offset + 1}–{end} von {projects.length} Projekten
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Vorherige Projektseite"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label="Nächste Projektseite"
            disabled={current === last}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight />
          </Button>
        </nav>
      )}
      {projects.slice(offset, end).map((project) => (
        <BaasConnectionCard
          key={`${project.provider}:${project.id || project.name}`}
          connection={project}
          database={databaseByProject.get(project)}
          onEditDatabase={onEditDatabase}
        />
      ))}
    </>
  );
}

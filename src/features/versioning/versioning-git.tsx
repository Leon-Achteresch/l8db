import { NewBadge } from "@/components/new-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHasNewFeatures } from "@/lib/new-features";
import { providerForKind } from "@/lib/providers";
import { deployable } from "@/lib/versioning/model";
import type { VersioningArea } from "@/lib/versioning/workflow";
import { useDevelopment } from "./use-development";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningBranchBar } from "./versioning-branch-bar";
import { VersioningSection } from "./versioning-section";
import { VERSIONING_SECTIONS } from "./versioning-sections";
import { VersioningWorkbench } from "./versioning-workbench";

export function VersioningGit({
  workspace,
  wide,
  section,
  onNavigate,
  area,
  onArea,
}: {
  workspace: VersioningWorkspace;
  wide: boolean;
  section: VersioningArea;
  onNavigate: (area: VersioningArea) => void;
  area: "database" | "git";
  onArea: (area: "database" | "git") => void;
}) {
  const development = useDevelopment(workspace);
  const reviewsNew = useHasNewFeatures("versioning.reviews");
  const deliveryNew = useHasNewFeatures("versioning.delivery");
  const { repo, status, project, busy } = workspace;
  if (!status || !project) return null;
  if (wide)
    return (
      <VersioningWorkbench
        workspace={workspace}
        development={development}
        section={section}
        onNavigate={onNavigate}
        area={area}
        onArea={onArea}
      />
    );
  const deploys = deployable(project.kind);
  const fresh: Partial<Record<VersioningArea, boolean>> = {
    reviews: reviewsNew,
    delivery: deliveryNew,
  };
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-5 pb-4 pt-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">{project.name}</h2>
          <p title={repo} className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {repo.split(/[\\/]/).filter(Boolean).at(-1)} <span className="mx-1 opacity-50">/</span>{" "}
            {providerForKind(project.kind)?.name ?? project.kind}
          </p>
        </div>
        <VersioningBranchBar workspace={workspace} className="shrink-0" />
      </div>
      <Tabs
        value={section}
        onValueChange={(next) => onNavigate(next as VersioningArea)}
        className="min-h-0 flex-1 gap-0"
      >
        <TabsList
          variant="line"
          aria-label="Versionierungsbereiche"
          className="mx-4 h-10 w-auto shrink-0 justify-start gap-1 overflow-x-auto border-b border-border/50 px-0"
        >
          {VERSIONING_SECTIONS.filter((entry) => deploys || !entry.deploy).map(
            ({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                disabled={busy}
                className="relative h-10 flex-none gap-1.5 rounded-none border-0 px-2.5 text-xs shadow-none data-[state=active]:text-foreground data-[state=active]:after:opacity-100 data-[state=active]:after:bg-primary data-[state=inactive]:text-muted-foreground"
              >
                <Icon className="size-3.5" />
                {label}
                {id === "development" && development.changes.size > 0 && (
                  <span className="ml-0.5 font-mono text-[10px] text-muted-foreground">
                    {development.changes.size}
                  </span>
                )}
                {fresh[id] && section !== id && <NewBadge />}
              </TabsTrigger>
            ),
          )}
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">
          <fieldset disabled={busy} className="min-w-0">
            <VersioningSection
              section={section}
              workspace={workspace}
              development={development}
              onNavigate={onNavigate}
            />
          </fieldset>
        </div>
      </Tabs>
    </>
  );
}

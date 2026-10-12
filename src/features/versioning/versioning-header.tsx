import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  GitPullRequestIcon,
  PanelRightIcon,
  PanelsTopLeftIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { useVersioningPanel } from "@/lib/versioning/panel";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningIconButton } from "./versioning-icon-button";
import { VersioningRepositoryPopover } from "./versioning-repository-popover";

export function VersioningHeader({
  workspace,
  area,
  className,
  compact = false,
}: {
  workspace: VersioningWorkspace;
  area: "database" | "git";
  className?: string;
  compact?: boolean;
}) {
  const { repo, status, busy, run, refresh } = workspace;
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const panel = useVersioningPanel();
  const tabFeature = useNewFeatureVisibility<HTMLButtonElement>("versioning.tab-view");
  const toggleMode = () => {
    if (panel.mode === "panel") {
      panel.setReturnPath(path === "/versioning" ? "/query" : path);
      panel.setMode("tab");
      useTableTabs.getState().openToolTab("versioning");
      void navigate({ to: "/versioning" });
    } else {
      panel.setMode("panel");
      void navigate({ to: panel.returnPath });
    }
  };
  return (
    <header className={cn("flex h-12 shrink-0 items-center gap-1 px-4", className)}>
      <GitPullRequestIcon className="mr-1 size-4 text-primary" strokeWidth={1.7} />
      <h1 className={cn("flex-1 truncate text-xs font-semibold", compact && "sr-only")}>
        Versionierung
      </h1>
      {compact && <span className="flex-1" />}
      {area === "git" && status && <VersioningRepositoryPopover workspace={workspace} />}
      <button
        ref={tabFeature.ref}
        type="button"
        aria-label={
          panel.mode === "panel"
            ? "Versionierung als Tab öffnen"
            : "Versionierung als Seitenpanel öffnen"
        }
        title={panel.mode === "panel" ? "Als Tab öffnen" : "Als Seitenpanel öffnen"}
        onClick={toggleMode}
        className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {panel.mode === "panel" ? (
          <PanelsTopLeftIcon className="size-4" />
        ) : (
          <PanelRightIcon className="size-4" />
        )}
      </button>
      {area === "git" && (
        <VersioningIconButton
          icon={RefreshCwIcon}
          label="Versionierung aktualisieren"
          disabled={busy || !repo}
          className={busy ? "animate-pulse" : ""}
          onClick={() => void run(() => refresh())}
        />
      )}
      <VersioningIconButton
        icon={XIcon}
        label="Versionierung schließen"
        onClick={() => useVersioningPanel.getState().setOpen(false)}
      />
    </header>
  );
}

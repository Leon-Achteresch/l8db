import { GitBranchIcon } from "lucide-react";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { isQueryTask, isTaskActive, useTasksStore } from "@/lib/tasks";
import { useVersioningPanel } from "@/lib/versioning/panel";
import { useWorkspaceStatusStore } from "@/lib/workspace-status";

export function WorkspaceBranchStatus() {
  const branch = useVersioningPanel((state) => state.branch);
  const message = useWorkspaceStatusStore((state) => state.message);
  const running = useTasksStore((state) =>
    state.tasks.some((task) => isQueryTask(task) && isTaskActive(task)),
  );
  const feature = useNewFeatureVisibility<HTMLButtonElement>("workspace.status.branch");
  if (!branch || message || running) return null;
  return (
    <button
      ref={feature.ref}
      type="button"
      onClick={() => useVersioningPanel.getState().setOpen(true)}
      className="flex min-w-0 items-center gap-1.5 rounded px-1 hover:text-foreground focus-visible:outline-2"
      title={`Branch ${branch} · Versionierung öffnen`}
      aria-label={`Branch ${branch} · Versionierung öffnen`}
    >
      <GitBranchIcon className="size-3 shrink-0" />
      <span className="max-w-32 truncate font-mono">{branch}</span>
    </button>
  );
}

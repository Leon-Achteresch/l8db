import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownIcon,
  ArrowDownUpIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  GitBranchIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { versioningRepository } from "@/lib/db";
import { cn } from "@/lib/utils";
import { remoteStatus } from "@/lib/versioning/delivery";
import type { VersioningWorkspace } from "./use-versioning";
import { VersioningPopover } from "./versioning-popover";
import { VersioningSelect } from "./versioning-select";

const SYNC = [
  { action: "fetch", label: "Fetch", description: "Remote-Stand abrufen", icon: RefreshCwIcon },
  {
    action: "pull",
    label: "Pull",
    description: "Lokalen Branch aktualisieren",
    icon: ArrowDownIcon,
  },
  { action: "push", label: "Push", description: "Commits veröffentlichen", icon: ArrowUpIcon },
] as const;

export function VersioningBranchBar({
  workspace,
  label,
  className,
}: {
  workspace: VersioningWorkspace;
  label?: string;
  className?: string;
}) {
  const { repo, status, busy, run, refresh } = workspace;
  const [branch, setBranch] = useState("");
  const remote = useQuery({
    queryKey: ["versioning-remote", repo, status?.head, status?.branch],
    enabled: Boolean(status),
    retry: false,
    staleTime: 10_000,
    queryFn: () => remoteStatus(repo),
  });
  if (!status) return null;
  const info = remote.data?.configured ? remote.data : null;
  return (
    <div className={cn("flex min-w-0 items-center gap-1", className)}>
      <VersioningPopover
        icon={GitBranchIcon}
        label="Branches"
        disabled={busy}
        trigger={
          <button
            type="button"
            disabled={busy}
            aria-label={`Branch: ${status.branch ?? "Detached HEAD"}`}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-muted"
          >
            <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono">{status.branch ?? "Detached HEAD"}</span>
            <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        }
      >
        <VersioningSelect
          label="Git-Branch"
          value={status.branch ?? ""}
          onChange={(value) => void run(() => workspace.git("checkout", value))}
          options={status.branches.map((value) => ({ value, label: value }))}
        />
        <div className="mt-1 space-y-2">
          <label className="text-xs font-medium" htmlFor="vcs-new-branch">
            Neuen Branch anlegen
          </label>
          <Input
            id="vcs-new-branch"
            aria-label="Neuer Branch"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            placeholder="feature/meine-aenderung"
          />
          <Button
            size="sm"
            className="w-full"
            disabled={!status.head || !branch.trim()}
            onClick={() => void run(() => workspace.git("branch", branch), "Branch erstellt")}
          >
            <PlusIcon className="size-3.5" />
            Branch erstellen
          </Button>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {status.head?.slice(0, 8) ?? "Noch kein Commit"}
        </span>
      </VersioningPopover>
      {info && (
        <span
          className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums"
          title={`${info.ahead ?? 0} lokale Commits nicht im Remote · ${info.behind ?? 0} Commits nicht abgeholt`}
        >
          ↑{info.ahead ?? 0} ↓{info.behind ?? 0}
        </span>
      )}
      <span
        title={label}
        className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground"
      >
        {label}
      </span>
      <VersioningPopover icon={ArrowDownUpIcon} label="Git synchronisieren" disabled={busy}>
        {SYNC.map(({ action, label, description, icon: Icon }) => (
          <button
            key={action}
            type="button"
            className="flex items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted"
            onClick={() =>
              void run(async () => {
                if (workspace.dirty)
                  throw new Error("Ungespeicherten Entwurf zuerst speichern oder verwerfen.");
                await versioningRepository({ action, repo });
                await refresh();
                await remote.refetch();
              }, `Git ${action} abgeschlossen`)
            }
          >
            <Icon className="size-4 text-muted-foreground" />
            <span className="text-xs font-medium">
              {label}
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {description}
              </span>
            </span>
          </button>
        ))}
      </VersioningPopover>
    </div>
  );
}

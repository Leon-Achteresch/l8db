import {
  ArchiveIcon,
  CircleAlertIcon,
  FileDiffIcon,
  GitBranchIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isDisposable } from "@/lib/branching/model";
import type { SavedConnection } from "@/lib/connections";
import type { SnapshotInfo } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { AuditLog } from "./audit-log";
import { BranchCreateDialog, type BranchPreset } from "./branch-create-dialog";
import { BranchTree } from "./branch-tree";
import { BranchingHeader } from "./branching-header";
import { BranchingPolicies } from "./branching-policies";
import { RestoreDialog } from "./restore-dialog";
import { SchemaCompare } from "./schema-compare";
import { SnapshotList } from "./snapshot-list";
import { useBranching } from "./use-branching";

type Area = "branches" | "snapshots" | "compare" | "audit" | "policies";

export function DatabaseBranching({
  connection,
  database,
}: {
  connection: SavedConnection;
  database: string;
}) {
  const workspace = useBranching(connection, database);
  const [area, setArea] = useState<Area>("branches");
  const [create, setCreate] = useState<BranchPreset | null>(null);
  const [restore, setRestore] = useState<SnapshotInfo | null>(null);
  const [comparison, setComparison] = useState<[string, string] | null>(null);
  const policiesFeature = useNewFeatureVisibility<HTMLButtonElement>(
    "versioning.database.policies",
  );
  const { overview, error, loading } = workspace;
  const compare = (left: string, right: string) => {
    setComparison([left, right]);
    setArea("compare");
  };
  const branches = overview?.databases.filter(
    (entry) => entry.name !== overview.root && !isDisposable(entry),
  ).length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <BranchingHeader workspace={workspace} onCreate={setCreate} />
      {error && (
        <div
          role="alert"
          className="mx-5 mb-3 flex gap-2 rounded-lg bg-destructive/5 p-3 text-xs leading-relaxed text-destructive"
        >
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 whitespace-pre-line break-words">{error}</span>
        </div>
      )}
      {loading && !overview && (
        <div className="space-y-3 px-5 pt-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
          <Skeleton className="h-12 rounded-xl" />
        </div>
      )}
      {overview && (
        <Tabs
          value={area}
          onValueChange={(next) => setArea(next as Area)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            variant="line"
            aria-label="Bereiche des Datenbank-Branchings"
            className="mx-4 w-auto shrink-0 justify-start gap-1 overflow-x-auto border-b border-border/50 px-0 py-0 group-data-horizontal/tabs:h-10"
          >
            {(
              [
                { id: "branches", label: "Branches", icon: GitBranchIcon, count: branches },
                {
                  id: "snapshots",
                  label: "Sicherungen",
                  icon: ArchiveIcon,
                  count: overview.snapshots.length,
                },
                { id: "compare", label: "Vergleich", icon: FileDiffIcon },
                { id: "audit", label: "Protokoll", icon: ScrollTextIcon },
                { id: "policies", label: "Richtlinien", icon: ShieldCheckIcon },
              ] as const
            ).map((item) => (
              <TabsTrigger
                key={item.id}
                value={item.id}
                ref={item.id === "policies" ? policiesFeature.ref : undefined}
                className="relative flex-none gap-1.5 rounded-none border-0 px-2.5 text-xs group-data-horizontal/tabs:after:bottom-0 shadow-none data-[state=active]:text-foreground data-[state=active]:after:opacity-100 data-[state=active]:after:bg-primary data-[state=inactive]:text-muted-foreground"
              >
                <item.icon className="size-3.5" />
                {item.label}
                {"count" in item && Boolean(item.count) && (
                  <span className="ml-0.5 font-mono text-[10px] text-muted-foreground">
                    {item.count}
                  </span>
                )}
                {item.id === "policies" && policiesFeature.isNew && <NewBadge />}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 pt-4">
            <TabsContent value="branches" className="m-0">
              <BranchTree workspace={workspace} onCreate={setCreate} onCompare={compare} />
            </TabsContent>
            <TabsContent value="snapshots" className="m-0">
              <SnapshotList
                workspace={workspace}
                onCreate={setCreate}
                onRestore={setRestore}
                onCompare={compare}
                onPolicies={() => setArea("policies")}
              />
            </TabsContent>
            <TabsContent value="compare" className="m-0">
              <SchemaCompare workspace={workspace} preset={comparison} />
            </TabsContent>
            <TabsContent value="audit" className="m-0">
              <AuditLog workspace={workspace} />
            </TabsContent>
            <TabsContent value="policies" className="m-0">
              <BranchingPolicies workspace={workspace} />
            </TabsContent>
          </div>
        </Tabs>
      )}
      {overview && create && (
        <BranchCreateDialog
          workspace={workspace}
          preset={create}
          onClose={() => setCreate(null)}
          onPolicies={() => {
            setCreate(null);
            setArea("policies");
          }}
        />
      )}
      {overview && restore && (
        <RestoreDialog workspace={workspace} snapshot={restore} onClose={() => setRestore(null)} />
      )}
    </div>
  );
}

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CLOUD_INFINITE_QUERY_OPTIONS,
  CLOUD_QUERY_OPTIONS,
  type CloudPage,
  type NeonBranch,
  type NeonProject,
  neonBranches,
  neonOrganizations,
  neonProjects,
} from "@/lib/db/cloud-accounts";
import { CloudLoadMore } from "./cloud-load-more";
import { CloudSectionError } from "./cloud-section-error";
import { NeonAuthPanel } from "./neon-auth-panel";
import { NeonConnectPanel } from "./neon-connect-panel";
import { NeonFunctionsPanel } from "./neon-functions-panel";
import { NeonStoragePanel } from "./neon-storage-panel";

const PERSONAL = "__personal__";

export function NeonAccountExplorer({ accountId }: { accountId: string }) {
  const [org, setOrg] = useState(PERSONAL);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [project, setProject] = useState<NeonProject | null>(null);
  const [branch, setBranch] = useState<NeonBranch | null>(null);
  const orgId = org === PERSONAL ? null : org;
  const organizations = useQuery({
    queryKey: ["cloud-accounts", accountId, "neon", "organizations"],
    queryFn: () => neonOrganizations(accountId),
    ...CLOUD_QUERY_OPTIONS,
  });
  const projects = useInfiniteQuery({
    queryKey: ["cloud-accounts", accountId, "neon", "projects", orgId, applied],
    initialPageParam: null as string | null,
    getNextPageParam: (last: CloudPage<NeonProject>) => last.next_cursor ?? undefined,
    queryFn: ({ pageParam }) =>
      neonProjects(accountId, { orgId, cursor: pageParam, search: applied }),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });
  const branches = useInfiniteQuery({
    queryKey: ["cloud-accounts", accountId, "neon", project?.id, "branches"],
    enabled: Boolean(project),
    initialPageParam: null as string | null,
    getNextPageParam: (last: CloudPage<NeonBranch>) => last.next_cursor ?? undefined,
    queryFn: ({ pageParam }) => neonBranches(accountId, project?.id ?? "", pageParam),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });
  const projectList = projects.data?.pages.flatMap((page) => page.items) ?? [];
  const branchList = branches.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={org}
          onValueChange={(value) => {
            setOrg(value);
            setProject(null);
            setBranch(null);
          }}
        >
          <SelectTrigger className="w-60" aria-label="Organisation">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PERSONAL}>Persönliches Konto / Schlüssel-Bereich</SelectItem>
            {organizations.data?.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search.trim());
          }}
        >
          <Input
            aria-label="Projekte suchen"
            placeholder="Projekte suchen"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-56"
          />
          <Button type="submit" variant="outline" size="sm">
            Suchen
          </Button>
        </form>
      </div>
      {organizations.isError && <CloudSectionError error={organizations.error} />}
      <div className="grid gap-4 lg:grid-cols-[16rem_14rem_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Projekte</h3>
          {projects.isError && (
            <CloudSectionError error={projects.error} onRetry={() => void projects.refetch()} />
          )}
          {projects.isLoading && <p className="text-sm text-muted-foreground">Lade…</p>}
          <ul className="flex flex-col gap-1">
            {projectList.map((entry) => (
              <li key={entry.id}>
                <Button
                  variant={project?.id === entry.id ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    setProject(entry);
                    setBranch(null);
                  }}
                >
                  <span className="truncate">{entry.name}</span>
                </Button>
              </li>
            ))}
          </ul>
          {!projects.isLoading && projectList.length === 0 && !projects.isError && (
            <p className="text-sm text-muted-foreground">Keine Projekte gefunden.</p>
          )}
          <CloudLoadMore
            hasMore={Boolean(projects.hasNextPage)}
            loading={projects.isFetchingNextPage}
            onLoad={() => void projects.fetchNextPage()}
          />
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Branches</h3>
          {!project && <p className="text-sm text-muted-foreground">Projekt auswählen.</p>}
          {branches.isError && (
            <CloudSectionError error={branches.error} onRetry={() => void branches.refetch()} />
          )}
          <ul className="flex flex-col gap-1">
            {branchList.map((entry) => (
              <li key={entry.id}>
                <Button
                  variant={branch?.id === entry.id ? "secondary" : "ghost"}
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => setBranch(entry)}
                >
                  <GitBranch className="size-3.5" />
                  <span className="truncate">{entry.name}</span>
                  {entry.default && <Badge variant="outline">Standard</Badge>}
                </Button>
              </li>
            ))}
          </ul>
          <CloudLoadMore
            hasMore={Boolean(branches.hasNextPage)}
            loading={branches.isFetchingNextPage}
            onLoad={() => void branches.fetchNextPage()}
          />
        </div>
        <div className="min-w-0">
          {project && branch ? (
            <Tabs defaultValue="connect" key={`${project.id}:${branch.id}`}>
              <TabsList>
                <TabsTrigger value="connect">Verbindung</TabsTrigger>
                <TabsTrigger value="auth">Auth</TabsTrigger>
                <TabsTrigger value="storage">Storage</TabsTrigger>
                <TabsTrigger value="functions">Functions</TabsTrigger>
              </TabsList>
              <TabsContent value="connect" className="pt-3">
                <NeonConnectPanel accountId={accountId} project={project} branch={branch} />
              </TabsContent>
              <TabsContent value="auth" className="pt-3">
                <NeonAuthPanel accountId={accountId} projectId={project.id} branchId={branch.id} />
              </TabsContent>
              <TabsContent value="storage" className="pt-3">
                <NeonStoragePanel
                  accountId={accountId}
                  projectId={project.id}
                  branchId={branch.id}
                />
              </TabsContent>
              <TabsContent value="functions" className="pt-3">
                <NeonFunctionsPanel
                  accountId={accountId}
                  projectId={project.id}
                  branchId={branch.id}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <p className="text-sm text-muted-foreground">
              Projekt und Branch wählen, um Verbindung, Auth, Storage und Functions zu sehen.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

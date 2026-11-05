import { useInfiniteQuery } from "@tanstack/react-query";
import { Database, GitBranch, KeyRound } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CLOUD_INFINITE_QUERY_OPTIONS,
  type PlanetScaleBranch,
  type PlanetScaleDatabase,
  type PlanetScaleOrganization,
  type PlanetScalePaged,
  planetScaleBranches,
  planetScaleDatabases,
  planetScaleOrganizations,
} from "@/lib/db/cloud-accounts";
import { CloudLoadMore } from "./cloud-load-more";
import { CloudSectionError } from "./cloud-section-error";
import { PlanetScaleCredentialDialog } from "./planetscale-credential-dialog";
import { PlanetScaleIssuedList } from "./planetscale-issued-list";

const SUPPORTED = new Set(["mysql", "postgresql"]);

export function PlanetScaleAccountExplorer({ accountId }: { accountId: string }) {
  const [organization, setOrganization] = useState<string | null>(null);
  const [database, setDatabase] = useState<PlanetScaleDatabase | null>(null);
  const [branch, setBranch] = useState<PlanetScaleBranch | null>(null);
  const [dialog, setDialog] = useState(false);
  const scope = ["cloud-accounts", accountId, "planetscale"] as const;
  const organizations = useInfiniteQuery({
    queryKey: [...scope, "organizations"],
    initialPageParam: null as number | null,
    getNextPageParam: (last: PlanetScalePaged<PlanetScaleOrganization>) =>
      last.next_page ?? undefined,
    queryFn: ({ pageParam }) => planetScaleOrganizations(accountId, pageParam),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });
  const databases = useInfiniteQuery({
    queryKey: [...scope, organization, "databases"],
    enabled: Boolean(organization),
    initialPageParam: null as number | null,
    getNextPageParam: (last: PlanetScalePaged<PlanetScaleDatabase>) => last.next_page ?? undefined,
    queryFn: ({ pageParam }) => planetScaleDatabases(accountId, organization ?? "", pageParam),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });
  const branches = useInfiniteQuery({
    queryKey: [...scope, organization, database?.name, "branches"],
    enabled: Boolean(organization && database),
    initialPageParam: null as number | null,
    getNextPageParam: (last: PlanetScalePaged<PlanetScaleBranch>) => last.next_page ?? undefined,
    queryFn: ({ pageParam }) =>
      planetScaleBranches(accountId, organization ?? "", database?.name ?? "", pageParam),
    ...CLOUD_INFINITE_QUERY_OPTIONS,
  });
  const orgList = organizations.data?.pages.flatMap((page) => page.items) ?? [];
  const dbList = databases.data?.pages.flatMap((page) => page.items) ?? [];
  const branchList = branches.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Organisationen</h3>
          {organizations.isError && (
            <CloudSectionError
              error={organizations.error}
              onRetry={() => void organizations.refetch()}
            />
          )}
          {orgList.map((entry) => (
            <Button
              key={entry.name}
              size="sm"
              variant={organization === entry.name ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => {
                setOrganization(entry.name);
                setDatabase(null);
                setBranch(null);
              }}
            >
              {entry.name}
            </Button>
          ))}
          <CloudLoadMore
            hasMore={Boolean(organizations.hasNextPage)}
            loading={organizations.isFetchingNextPage}
            onLoad={() => void organizations.fetchNextPage()}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Datenbanken</h3>
          {!organization && (
            <p className="text-sm text-muted-foreground">Organisation auswählen.</p>
          )}
          {databases.isError && (
            <CloudSectionError error={databases.error} onRetry={() => void databases.refetch()} />
          )}
          {dbList.map((entry) => (
            <Button
              key={entry.name}
              size="sm"
              variant={database?.name === entry.name ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => {
                setDatabase(entry);
                setBranch(null);
              }}
            >
              <Database className="size-3.5" />
              <span className="truncate">{entry.name}</span>
              <Badge variant="outline">
                {entry.kind === "postgresql" ? "PostgreSQL" : entry.kind}
              </Badge>
            </Button>
          ))}
          <CloudLoadMore
            hasMore={Boolean(databases.hasNextPage)}
            loading={databases.isFetchingNextPage}
            onLoad={() => void databases.fetchNextPage()}
          />
        </section>
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase text-muted-foreground">Branches</h3>
          {!database && <p className="text-sm text-muted-foreground">Datenbank auswählen.</p>}
          {branches.isError && (
            <CloudSectionError error={branches.error} onRetry={() => void branches.refetch()} />
          )}
          {branchList.map((entry) => (
            <Button
              key={entry.name}
              size="sm"
              variant={branch?.name === entry.name ? "secondary" : "ghost"}
              className="justify-start"
              onClick={() => setBranch(entry)}
            >
              <GitBranch className="size-3.5" />
              <span className="truncate">{entry.name}</span>
              {entry.production && <Badge variant="outline">Produktion</Badge>}
            </Button>
          ))}
          <CloudLoadMore
            hasMore={Boolean(branches.hasNextPage)}
            loading={branches.isFetchingNextPage}
            onLoad={() => void branches.fetchNextPage()}
          />
          {organization && database && branch && (
            <div className="flex flex-col gap-2 pt-2">
              {SUPPORTED.has(database.kind) ? (
                <Button size="sm" className="self-start" onClick={() => setDialog(true)}>
                  <KeyRound className="size-3.5" />
                  Lesende Zugangsdaten anlegen
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Datenbanktyp „{database.kind}“ wird für automatische Zugangsdaten noch nicht
                  unterstützt.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
      <PlanetScaleIssuedList accountId={accountId} />
      {organization && database && branch && (
        <PlanetScaleCredentialDialog
          accountId={accountId}
          organization={organization}
          database={database}
          branch={branch}
          open={dialog}
          onOpenChange={setDialog}
        />
      )}
    </div>
  );
}

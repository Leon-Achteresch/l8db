import { useNavigate } from "@tanstack/react-router";
import {
  CodeIcon,
  CopyPlusIcon,
  GaugeIcon,
  KeyRoundIcon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreatePrincipalDialog } from "@/features/users/principal-view/create-principal-dialog";
import { DropPrincipalDialog } from "@/features/users/principal-view/drop-principal-dialog";
import { GrantChecklist } from "@/features/users/principal-view/grant-checklist";
import { ObjectGrantsPanel } from "@/features/users/principal-view/object-grants-panel";
import { PasswordDialog } from "@/features/users/principal-view/password-dialog";
import {
  changeCount,
  changeOf,
  draftOf,
  type PrincipalDraft,
} from "@/features/users/principal-view/principal-draft";
import { PrincipalOverview } from "@/features/users/principal-view/principal-overview";
import { PrincipalScript } from "@/features/users/principal-view/principal-script";
import { PrincipalSqlDialog } from "@/features/users/principal-view/principal-sql-dialog";
import { ProfileLimitsPanel } from "@/features/users/principal-view/profile-limits-panel";
import { QuotasPanel } from "@/features/users/principal-view/quotas-panel";
import { useApplyPrincipalChange } from "@/features/users/principal-view/use-apply-principal-change";
import { useActiveConnection } from "@/lib/connections";
import type { PrincipalChange, PrincipalDetail, PrincipalKind } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  usePrincipalDetailQuery,
  usePrincipalOptionsQuery,
  usePrincipalsQuery,
} from "@/lib/queries";
import { tabStateKey, useTabState } from "@/lib/tab-state";
import { tabKey, useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";
import { useWorkspacePane } from "@/lib/workspace-pane";

const ICON: Record<PrincipalKind, typeof UserIcon> = {
  user: UserIcon,
  role: ShieldIcon,
  profile: GaugeIcon,
};

const CREATE: { kind: PrincipalKind; label: string }[] = [
  { kind: "user", label: "Benutzer" },
  { kind: "role", label: "Rolle" },
  { kind: "profile", label: "Profil" },
];

export function PrincipalView({ name, profile = false }: { name: string; profile?: boolean }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const navigate = useNavigate();
  const pane = useWorkspacePane();
  const openRoleTab = useTableTabs((state) => state.openRoleTab);
  const closeTab = useTableTabs((state) => state.closeTab);
  const apply = useApplyPrincipalChange();
  const principals = usePrincipalsQuery();
  const listed = principals.data?.items.find(
    (item) => item.name === name && (item.kind === "profile") === profile,
  );
  const kind: PrincipalKind = profile ? "profile" : (listed?.kind ?? "user");
  const {
    data: detail,
    isLoading,
    error,
  } = usePrincipalDetailQuery(kind, name, profile || Boolean(listed));
  const { data: options } = usePrincipalOptionsQuery(kind !== "profile");

  const scope = `principal:${connection?.id}:${database}:${kind}:${name}`;
  const [stored, setStored] = useTabState<{
    detail?: PrincipalDetail;
    draft: PrincipalDraft;
  } | null>(tabStateKey(scope, "draft"), null);
  const [tab, setTab] = useTabState<string>(tabStateKey(scope, "tab"), "");
  const [applying, setApplying] = useState(false);
  const [sqlOpen, setSqlOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [creating, setCreating] = useState<{ kind: PrincipalKind; clone: boolean } | null>(null);

  useEffect(() => {
    if (!pane) openRoleTab({ name, profile: profile || undefined });
  }, [name, profile, openRoleTab, pane]);

  const pending = useMemo(() => {
    const origin = stored?.detail ?? detail;
    if (!stored || !origin) return null;
    const change = changeOf(origin, stored.draft);
    const count = changeCount(change);
    return count > 0 ? { origin, draft: stored.draft, change, count } : null;
  }, [stored, detail]);
  const origin = pending?.origin ?? detail;
  const base = useMemo(() => (origin ? draftOf(origin) : null), [origin]);
  const draft = pending?.draft ?? base;
  const change: PrincipalChange = pending?.change ?? { kind, name, action: "alter" };
  const count = pending?.count ?? 0;
  const items = principals.data?.items ?? [];
  const roles = useMemo(
    () => items.filter((item) => item.kind === "role" && item.name !== name),
    [items, name],
  );
  const grantees = useMemo(
    () => items.filter((item) => item.kind !== "profile" && item.name !== name),
    [items, name],
  );
  const owners = useMemo(
    () => items.filter((item) => item.kind === "user").map((item) => item.name),
    [items],
  );
  const profiles = useMemo(
    () => items.filter((item) => item.kind === "profile").map((item) => item.name),
    [items],
  );
  const privileges = useMemo(
    () => (options?.system_privileges ?? []).map((privilege) => ({ name: privilege })),
    [options],
  );

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-6">
        <p className="text-sm font-medium text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading || principals.isLoading) {
    return (
      <div className="flex-1 space-y-3 overflow-hidden bg-background p-4 select-none">
        <Skeleton className="h-6 w-64 bg-muted/50" />
        <Skeleton className="h-5 w-96 bg-muted/30" />
        <Skeleton className="h-5 w-80 bg-muted/30" />
      </div>
    );
  }

  if (error || !detail || !origin || !base || !draft) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-6">
        <p className="max-w-md text-center text-[13px] text-muted-foreground select-text">
          {error ? String(error) : `"${name}" nicht gefunden.`}
        </p>
      </div>
    );
  }

  const update = (patch: Partial<PrincipalDraft>) =>
    setStored({ detail: origin, draft: { ...draft, ...patch } });
  const Icon = ICON[kind];
  const sections =
    kind === "user"
      ? [
          { value: "overview", label: "Übersicht", icon: UserIcon },
          { value: "roles", label: "Rollen", count: Object.keys(draft.roles).length },
          {
            value: "system",
            label: "Systemrechte",
            count: Object.keys(draft.systemPrivileges).length,
          },
          { value: "objects", label: "Objektrechte", count: draft.objectPrivileges.length },
          {
            value: "quotas",
            label: "Quotas",
            count: Object.values(draft.quotas).filter((max) => max !== 0).length,
          },
          { value: "script", label: "Skript", icon: CodeIcon },
        ]
      : kind === "role"
        ? [
            { value: "roles", label: "Rollen", count: Object.keys(draft.roles).length },
            {
              value: "system",
              label: "Systemrechte",
              count: Object.keys(draft.systemPrivileges).length,
            },
            { value: "objects", label: "Objektrechte", count: draft.objectPrivileges.length },
            { value: "members", label: "Mitglieder", count: Object.keys(draft.members).length },
            { value: "script", label: "Skript", icon: CodeIcon },
          ]
        : [
            { value: "limits", label: "Limits", icon: GaugeIcon },
            { value: "members", label: "Benutzer", count: detail.members.length },
            { value: "script", label: "Skript", icon: CodeIcon },
          ];
  const active = sections.some((section) => section.value === tab) ? tab : sections[0].value;

  const run = async () => {
    setApplying(true);
    const done = await apply(change);
    setApplying(false);
    if (!done) {
      setStored({ draft });
      return;
    }
    setStored(null);
    setSqlOpen(false);
    toast.success(`${name} aktualisiert`);
  };

  const toggleLock = async () => {
    const locked = !detail.locked;
    if (await apply({ kind: "user", name, action: "alter", locked }))
      toast.success(locked ? `${name} gesperrt` : `${name} entsperrt`);
  };

  const drop = async (cascade: boolean) => {
    if (!(await apply({ kind, name, action: "drop", cascade }))) return;
    toast.success(`${name} gelöscht`);
    setStored(null);
    closeTab(tabKey({ kind: "role", name, profile: profile || undefined }));
    navigate({ to: "/" });
  };

  return (
    <Tabs
      value={active}
      onValueChange={setTab}
      className="flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="truncate font-mono text-sm font-semibold tracking-tight">{name}</h2>
        {detail.status && (
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                detail.locked
                  ? "bg-destructive"
                  : detail.expired
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
            />
            {detail.status}
          </span>
        )}
        {detail.system && <Badge variant="secondary">System</Badge>}
        {detail.limited && (
          <Badge variant="outline" title="Ohne Leserechte auf die DBA-Views">
            Eingeschränkte Sicht
          </Badge>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="xs">
                <PlusIcon data-icon="inline-start" />
                Neu
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {CREATE.map((entry) => (
                <DropdownMenuItem
                  key={entry.kind}
                  onSelect={() => setCreating({ kind: entry.kind, clone: false })}
                >
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {kind === "user" && (
            <>
              <Button variant="outline" size="xs" onClick={toggleLock}>
                {detail.locked ? (
                  <LockOpenIcon data-icon="inline-start" />
                ) : (
                  <LockIcon data-icon="inline-start" />
                )}
                {detail.locked ? "Entsperren" : "Sperren"}
              </Button>
              <Button variant="outline" size="xs" onClick={() => setPasswordOpen(true)}>
                <KeyRoundIcon data-icon="inline-start" />
                Passwort
              </Button>
            </>
          )}
          <Button variant="outline" size="xs" onClick={() => setCreating({ kind, clone: true })}>
            <CopyPlusIcon data-icon="inline-start" />
            Klonen
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="text-destructive"
            onClick={() => setDropOpen(true)}
          >
            <TrashIcon data-icon="inline-start" />
            Löschen
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 items-center px-3">
        <TabsList variant="line" className="h-9">
          {sections.map((section) => (
            <TabsTrigger key={section.value} value={section.value}>
              {section.icon ? <section.icon className="size-3.5" /> : null}
              {section.label}
              {section.count !== undefined && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {section.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <TabsContent value="overview">
          <PrincipalOverview
            detail={detail}
            before={base}
            draft={draft}
            tablespaces={options?.tablespaces ?? []}
            temporaryTablespaces={options?.temporary_tablespaces ?? []}
            profiles={profiles}
            onChange={update}
          />
        </TabsContent>
        <TabsContent value="roles">
          <GrantChecklist
            items={roles}
            value={draft.roles}
            original={base.roles}
            onChange={(next) => update({ roles: next })}
            withDefault={kind === "user"}
            placeholder="Rolle suchen"
          />
        </TabsContent>
        <TabsContent value="system">
          <GrantChecklist
            items={privileges}
            value={draft.systemPrivileges}
            original={base.systemPrivileges}
            onChange={(next) => update({ systemPrivileges: next })}
            placeholder="Systemrecht suchen"
          />
        </TabsContent>
        <TabsContent value="objects">
          <ObjectGrantsPanel
            grants={draft.objectPrivileges}
            original={origin.object_privileges}
            truncated={origin.object_privileges_truncated}
            owners={owners}
            allowGrantOption={kind === "user"}
            onChange={(next) => update({ objectPrivileges: next })}
          />
        </TabsContent>
        <TabsContent value="quotas">
          <QuotasPanel
            tablespaces={options?.tablespaces ?? []}
            value={draft.quotas}
            original={origin.quotas}
            onChange={(next) => update({ quotas: next })}
          />
        </TabsContent>
        <TabsContent value="members">
          {kind === "role" ? (
            <GrantChecklist
              items={grantees}
              value={draft.members}
              original={base.members}
              onChange={(next) => update({ members: next })}
              placeholder="Benutzer oder Rolle suchen"
            />
          ) : (
            <div className="flex max-w-3xl flex-col">
              {detail.members.map((member) => (
                <div
                  key={member.name}
                  className="flex h-8 items-center gap-2.5 rounded-lg px-2 font-mono text-xs hover:bg-muted/50"
                >
                  <UsersIcon className="size-3.5 text-muted-foreground" />
                  {member.name}
                </div>
              ))}
              {detail.members.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-muted-foreground">Keine Benutzer.</p>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="limits">
          <ProfileLimitsPanel
            limits={origin.limits}
            value={draft.limits}
            onChange={(next) => update({ limits: next })}
          />
        </TabsContent>
        <TabsContent value="script">
          <PrincipalScript script={detail.script} />
        </TabsContent>
      </div>
      {count > 0 && (
        <div className="flex shrink-0 items-center gap-2 bg-muted/40 px-4 py-2">
          <span className="size-1.5 rounded-full bg-primary" />
          <span className="text-[13px] font-medium tabular-nums">
            {count} {count === 1 ? "Änderung" : "Änderungen"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setSqlOpen(true)}>
              <CodeIcon data-icon="inline-start" />
              SQL
            </Button>
            <Button variant="ghost" size="sm" disabled={applying} onClick={() => setStored(null)}>
              Verwerfen
            </Button>
            <Button size="sm" disabled={applying} onClick={run}>
              {applying && <Spinner />}
              Anwenden
            </Button>
          </div>
        </div>
      )}
      {sqlOpen && (
        <PrincipalSqlDialog
          open
          onOpenChange={setSqlOpen}
          change={change}
          applying={applying}
          onApply={run}
        />
      )}
      {passwordOpen && <PasswordDialog open onOpenChange={setPasswordOpen} name={name} />}
      {dropOpen && (
        <DropPrincipalDialog
          open
          onOpenChange={setDropOpen}
          kind={kind}
          name={name}
          onDrop={drop}
        />
      )}
      {creating && (
        <CreatePrincipalDialog
          open
          onOpenChange={(open) => !open && setCreating(null)}
          kind={creating.kind}
          template={creating.clone ? detail : undefined}
        />
      )}
    </Tabs>
  );
}

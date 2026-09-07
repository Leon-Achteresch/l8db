import { useQueryClient } from "@tanstack/react-query";

import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  TrashIcon,
  TriangleAlertIcon,
  UndoIcon,
  UserIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveConnection } from "@/lib/connections";
import {
  type AlterRoleOptions,
  alterRole,
  type CreateRoleOptions,
  createRole,
  dropRole,
  modifyPrivilege,
  type PrivilegeChange,
  type RoleInfo,
  type SchemaPrivileges,
  type TablePrivileges,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useRolePrivilegesQuery, useRolesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

const TABLE_PRIVS = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
] as const;

const TABLE_PRIV_SHORT: Record<string, string> = {
  SELECT: "SEL",
  INSERT: "INS",
  UPDATE: "UPD",
  DELETE: "DEL",
  TRUNCATE: "TRU",
  REFERENCES: "REF",
  TRIGGER: "TRI",
};

const SCHEMA_PRIVS = ["USAGE", "CREATE"] as const;

function privKey(tp: TablePrivileges, priv: string): boolean {
  switch (priv) {
    case "SELECT":
      return tp.select;
    case "INSERT":
      return tp.insert;
    case "UPDATE":
      return tp.update;
    case "DELETE":
      return tp.delete;
    case "TRUNCATE":
      return tp.truncate;
    case "REFERENCES":
      return tp.references;
    case "TRIGGER":
      return tp.trigger;
    default:
      return false;
  }
}

export function UsersView({ name }: { name: string }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const openRoleTab = useTableTabs((state) => state.openRoleTab);
  const navigate = useNavigate();
  const { data: roles, isLoading, isError, error } = useRolesQuery();

  const role = roles?.find((r) => r.name === name);

  const [editing, setEditing] = useState(false);
  const [editState, setEditState] = useState<EditFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    openRoleTab({ name });
  }, [name, openRoleTab]);

  const handleEdit = useCallback(() => {
    if (!role) return;
    setEditing(true);
    setEditState({
      superuser: role.superuser,
      can_login: role.can_login,
      create_db: role.create_db,
      create_role: role.create_role,
      replication: role.replication,
      bypass_rls: role.bypass_rls,
      conn_limit: role.conn_limit === -1 ? "" : String(role.conn_limit),
      valid_until: role.valid_until ?? "",
      password: "",
      grant_roles: [],
      revoke_roles: [],
      current_member_of: [...role.member_of],
    });
  }, [role]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setEditState(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!connection || !role || !editState) return;
    setSaving(true);
    try {
      const options: AlterRoleOptions = {
        name: role.name,
        superuser: editState.superuser !== role.superuser ? editState.superuser : undefined,
        can_login: editState.can_login !== role.can_login ? editState.can_login : undefined,
        create_db: editState.create_db !== role.create_db ? editState.create_db : undefined,
        create_role: editState.create_role !== role.create_role ? editState.create_role : undefined,
        replication: editState.replication !== role.replication ? editState.replication : undefined,
        bypass_rls: editState.bypass_rls !== role.bypass_rls ? editState.bypass_rls : undefined,
        conn_limit: editState.conn_limit !== "" ? Number(editState.conn_limit) : undefined,
        password: editState.password || undefined,
        valid_until: editState.valid_until || undefined,
        clear_valid_until: role.valid_until !== null && editState.valid_until === "",
        grant_roles: editState.grant_roles,
        revoke_roles: editState.revoke_roles,
      };
      await alterRole(
        connection.kind,
        effectiveConnectionString(connection),
        options,
        database ?? undefined,
      );
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      setEditing(false);
      setEditState(null);
      toast.success(`Rolle "${role.name}" aktualisiert`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }, [connection, database, role, editState, queryClient]);

  const handleDelete = useCallback(async () => {
    if (!connection || !role) return;
    setDeleting(true);
    try {
      await dropRole(
        connection.kind,
        effectiveConnectionString(connection),
        role.name,
        database ?? undefined,
      );
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast.success(`Rolle "${role.name}" gelöscht`);
      navigate({ to: "/" });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDeleting(false);
    }
  }, [connection, database, role, queryClient, navigate]);

  const toggleMembership = useCallback(
    (roleName: string) => {
      if (!editState) return;
      const isCurrent = editState.current_member_of.includes(roleName);
      const isGranted = editState.grant_roles.includes(roleName);
      const isRevoked = editState.revoke_roles.includes(roleName);

      if (isCurrent) {
        if (isRevoked) {
          setEditState({
            ...editState,
            revoke_roles: editState.revoke_roles.filter((r) => r !== roleName),
            current_member_of: [...editState.current_member_of],
          });
        } else {
          setEditState({
            ...editState,
            revoke_roles: [...editState.revoke_roles, roleName],
          });
        }
      } else {
        if (isGranted) {
          setEditState({
            ...editState,
            grant_roles: editState.grant_roles.filter((r) => r !== roleName),
          });
        } else {
          setEditState({
            ...editState,
            grant_roles: [...editState.grant_roles, roleName],
          });
        }
      }
    },
    [editState],
  );

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-hidden bg-background p-4 space-y-3 select-none">
        <Skeleton className="h-6 w-64 bg-muted/50" />
        <div className="space-y-2 mt-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton
              key={i}
              className="h-5 bg-muted/30"
              style={{ width: `${40 + Math.random() * 40}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
          <TriangleAlertIcon className="size-8 text-destructive animate-bounce" />
          <h3 className="text-sm font-semibold text-destructive">Fehler beim Laden der Rollen</h3>
          <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
            {String(error)}
          </p>
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">
          Rolle &quot;{name}&quot; nicht gefunden.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {role.can_login ? (
            <UserIcon className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ShieldIcon className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground truncate">{role.name}</span>
          <Badge variant={role.can_login ? "default" : "secondary"}>
            {role.can_login ? "Login" : "Rolle"}
          </Badge>
          {role.superuser && <Badge variant="destructive">Superuser</Badge>}
        </div>
        {!editing ? (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" onClick={() => setCreateOpen(true)}>
              <PlusIcon data-icon="inline-start" />
              Neue Rolle
            </Button>
            <Button variant="outline" size="xs" onClick={handleEdit}>
              <PencilIcon data-icon="inline-start" />
              Bearbeiten
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="xs" className="text-destructive">
                  <TrashIcon data-icon="inline-start" />
                  Löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rolle löschen?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Die Rolle &quot;{role.name}&quot; wird unwiderruflich gelöscht.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} disabled={deleting}>
                    {deleting ? <LoaderIcon className="size-4 animate-spin" /> : null}
                    Löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="xs" onClick={handleCancel}>
              <UndoIcon data-icon="inline-start" />
              Abbrechen
            </Button>
            <Button variant="default" size="xs" onClick={handleSave} disabled={saving}>
              {saving ? (
                <LoaderIcon data-icon="inline-start" className="animate-spin" />
              ) : (
                <CheckIcon data-icon="inline-start" />
              )}
              Speichern
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {editing && editState ? (
          <RoleEditForm
            role={role}
            state={editState}
            onChange={setEditState}
            allRoles={roles ?? []}
            toggleMembership={toggleMembership}
          />
        ) : (
          <RoleDetailView role={role} />
        )}
      </div>

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} allRoles={roles ?? []} />
    </div>
  );
}

interface EditFormState {
  superuser: boolean;
  can_login: boolean;
  create_db: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: string;
  valid_until: string;
  password: string;
  grant_roles: string[];
  revoke_roles: string[];
  current_member_of: string[];
}

function RoleDetailView({ role }: { role: RoleInfo }) {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Eigenschaften</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <PropertyRow label="Superuser" value={role.superuser} />
            <PropertyRow label="Login" value={role.can_login} />
            <PropertyRow label="Create DB" value={role.create_db} />
            <PropertyRow label="Create Role" value={role.create_role} />
            <PropertyRow label="Replication" value={role.replication} />
            <PropertyRow label="Bypass RLS" value={role.bypass_rls} />
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Connection Limit</span>
              <span className="font-mono">
                {role.conn_limit === -1 ? "Unbegrenzt" : role.conn_limit}
              </span>
            </div>
            <div className="flex items-center justify-between py-1">
              <span className="text-muted-foreground">Gültig bis</span>
              <span className="font-mono">{role.valid_until ?? "Unbegrenzt"}</span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Mitglied von</h3>
          {role.member_of.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Mitgliedschaften.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {role.member_of.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Mitglieder</h3>
          {role.members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Keine Mitglieder.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {role.members.map((r) => (
                <Badge key={r} variant="outline">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold">OID</h3>
          <p className="text-sm font-mono text-muted-foreground">{role.oid}</p>
        </section>
      </div>

      <PrivilegesPanel roleName={role.name} />
    </div>
  );
}

function PrivilegesPanel({ roleName }: { roleName: string }) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const { data: privileges, isLoading, isError, error } = useRolePrivilegesQuery(roleName);

  const [pendingChanges, setPendingChanges] = useState<Set<string>>(new Set());

  const schemaGroups = useMemo(() => {
    if (!privileges) return [];
    const map = new Map<string, TablePrivileges[]>();
    for (const tp of privileges.tables) {
      const list = map.get(tp.schema) ?? [];
      list.push(tp);
      map.set(tp.schema, list);
    }
    return Array.from(map.entries()).map(([schema, tables]) => ({
      schema,
      tables,
    }));
  }, [privileges]);

  const handleToggle = useCallback(
    async (change: PrivilegeChange) => {
      if (!connection) return;
      const changeKey = `${change.object_type}:${change.schema}:${change.table}:${change.privilege}`;
      setPendingChanges((prev) => new Set(prev).add(changeKey));
      try {
        await modifyPrivilege(
          connection.kind,
          effectiveConnectionString(connection),
          change,
          database ?? undefined,
        );
        await queryClient.invalidateQueries({
          queryKey: ["role-privileges"],
        });
      } catch (e) {
        toast.error(String(e));
      } finally {
        setPendingChanges((prev) => {
          const next = new Set(prev);
          next.delete(changeKey);
          return next;
        });
      }
    },
    [connection, database, queryClient],
  );

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Rechte</h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          Lade Rechte…
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Rechte</h3>
        <p className="text-sm text-destructive">{String(error)}</p>
      </section>
    );
  }

  if (!privileges) return null;

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold">Rechte</h3>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Schema-Rechte
        </h4>
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-3 py-2 text-left font-medium text-xs">Schema</th>
                {SCHEMA_PRIVS.map((p) => (
                  <th key={p} className="w-20 px-2 py-2 text-center font-medium text-xs">
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {privileges.schemas.map((sp) => (
                <SchemaPrivRow
                  key={sp.schema}
                  sp={sp}
                  roleName={roleName}
                  pendingChanges={pendingChanges}
                  onToggle={handleToggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Tabellen- & View-Rechte
        </h4>
        {schemaGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine Objekte.</p>
        ) : (
          <div className="space-y-2">
            {schemaGroups.map((group) => (
              <SchemaTableGroup
                key={group.schema}
                schema={group.schema}
                tables={group.tables}
                roleName={roleName}
                pendingChanges={pendingChanges}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SchemaPrivRow({
  sp,
  roleName,
  pendingChanges,
  onToggle,
}: {
  sp: SchemaPrivileges;
  roleName: string;
  pendingChanges: Set<string>;
  onToggle: (change: PrivilegeChange) => void;
}) {
  return (
    <tr className="border-b last:border-0 hover:bg-muted/20 transition-colors">
      <td className="px-3 py-1.5 font-mono text-xs">{sp.schema}</td>
      {SCHEMA_PRIVS.map((priv) => {
        const hasPriv = priv === "USAGE" ? sp.usage : sp.create;
        const changeKey = `schema:${sp.schema}:undefined:${priv}`;
        const isPending = pendingChanges.has(changeKey);
        return (
          <td key={priv} className="px-2 py-1.5 text-center">
            <PrivCheckbox
              checked={hasPriv}
              pending={isPending}
              onToggle={() =>
                onToggle({
                  grant: !hasPriv,
                  privilege: priv,
                  object_type: "schema",
                  schema: sp.schema,
                  role_name: roleName,
                })
              }
            />
          </td>
        );
      })}
    </tr>
  );
}

function SchemaTableGroup({
  schema,
  tables,
  roleName,
  pendingChanges,
  onToggle,
}: {
  schema: string;
  tables: TablePrivileges[];
  roleName: string;
  pendingChanges: Set<string>;
  onToggle: (change: PrivilegeChange) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);

  const grantedCount = useMemo(() => {
    let count = 0;
    for (const tp of tables) {
      for (const priv of TABLE_PRIVS) {
        if (privKey(tp, priv)) count++;
      }
    }
    return count;
  }, [tables]);

  const totalCount = tables.length * TABLE_PRIVS.length;

  return (
    <motion.div layout transition={{ layout: SPRING_LAYOUT }} className="rounded-lg border">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-xs font-medium font-mono">{schema}</span>
        <span className="text-xs text-muted-foreground">
          {tables.length} {tables.length === 1 ? "Objekt" : "Objekte"}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {grantedCount}/{totalCount}
        </span>
        <PrivBar granted={grantedCount} total={totalCount} />
      </button>
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t bg-muted/30">
                <th className="px-3 py-1.5 text-left font-medium text-xs min-w-[180px]">Objekt</th>
                <th className="px-2 py-1.5 text-left font-medium text-xs w-16">Typ</th>
                {TABLE_PRIVS.map((p) => (
                  <TooltipProvider key={p} delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <th className="w-12 px-1 py-1.5 text-center font-medium text-xs cursor-help">
                          {TABLE_PRIV_SHORT[p]}
                        </th>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        <p className="text-xs">{p}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
                <th className="w-12 px-1 py-1.5 text-center font-medium text-xs">ALL</th>
              </tr>
            </thead>
            <tbody>
              {tables.map((tp) => (
                <TablePrivRow
                  key={`${tp.schema}.${tp.table}`}
                  tp={tp}
                  roleName={roleName}
                  pendingChanges={pendingChanges}
                  onToggle={onToggle}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}

function TablePrivRow({
  tp,
  roleName,
  pendingChanges,
  onToggle,
}: {
  tp: TablePrivileges;
  roleName: string;
  pendingChanges: Set<string>;
  onToggle: (change: PrivilegeChange) => void;
}) {
  const allGranted = TABLE_PRIVS.every((p) => privKey(tp, p));

  const handleToggleAll = () => {
    onToggle({
      grant: !allGranted,
      privilege: "ALL PRIVILEGES",
      object_type: tp.object_type,
      schema: tp.schema,
      table: tp.table,
      role_name: roleName,
    });
  };

  return (
    <tr className="border-t hover:bg-muted/20 transition-colors">
      <td className="px-3 py-1 font-mono text-xs truncate max-w-[220px]">{tp.table}</td>
      <td className="px-2 py-1">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px] px-1.5 py-0",
            tp.object_type === "view" && "border-cyan-500/30 text-cyan-600 dark:text-cyan-400",
            tp.object_type === "sequence" &&
              "border-amber-500/30 text-amber-600 dark:text-amber-400",
          )}
        >
          {tp.object_type === "materialized_view" ? "mview" : tp.object_type}
        </Badge>
      </td>
      {TABLE_PRIVS.map((priv) => {
        const hasPriv = privKey(tp, priv);
        const changeKey = `${tp.object_type}:${tp.schema}:${tp.table}:${priv}`;
        const isPending = pendingChanges.has(changeKey);
        return (
          <td key={priv} className="px-1 py-1 text-center">
            <PrivCheckbox
              checked={hasPriv}
              pending={isPending}
              onToggle={() =>
                onToggle({
                  grant: !hasPriv,
                  privilege: priv,
                  object_type: tp.object_type,
                  schema: tp.schema,
                  table: tp.table,
                  role_name: roleName,
                })
              }
            />
          </td>
        );
      })}
      <td className="px-1 py-1 text-center">
        <PrivCheckbox checked={allGranted} pending={false} onToggle={handleToggleAll} />
      </td>
    </tr>
  );
}

function PrivCheckbox({
  checked,
  pending,
  onToggle,
}: {
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  if (pending) {
    return (
      <div className="inline-flex items-center justify-center size-4">
        <LoaderIcon className="size-3 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Checkbox
      checked={checked}
      onCheckedChange={onToggle}
      className={cn(
        "size-4",
        checked && "data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600",
      )}
    />
  );
}

function PrivBar({ granted, total }: { granted: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((granted / total) * 100);
  return (
    <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
      <div
        className={cn(
          "h-full rounded-full transition-all",
          pct === 0 ? "bg-muted" : pct === 100 ? "bg-emerald-500" : "bg-amber-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function PropertyRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground">{label}</span>
      {value ? <Badge variant="default">Ja</Badge> : <Badge variant="secondary">Nein</Badge>}
    </div>
  );
}

function RoleEditForm({
  role,
  state,
  onChange,
  allRoles,
  toggleMembership,
}: {
  role: RoleInfo;
  state: EditFormState;
  onChange: (s: EditFormState) => void;
  allRoles: RoleInfo[];
  toggleMembership: (name: string) => void;
}) {
  const otherRoles = allRoles.filter((r) => r.name !== role.name);

  const effectiveMemberships = new Set<string>();
  for (const r of state.current_member_of) {
    if (!state.revoke_roles.includes(r)) {
      effectiveMemberships.add(r);
    }
  }
  for (const r of state.grant_roles) {
    effectiveMemberships.add(r);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Eigenschaften</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          <SwitchRow
            label="Superuser"
            checked={state.superuser}
            onCheckedChange={(v) => onChange({ ...state, superuser: v })}
          />
          <SwitchRow
            label="Login"
            checked={state.can_login}
            onCheckedChange={(v) => onChange({ ...state, can_login: v })}
          />
          <SwitchRow
            label="Create DB"
            checked={state.create_db}
            onCheckedChange={(v) => onChange({ ...state, create_db: v })}
          />
          <SwitchRow
            label="Create Role"
            checked={state.create_role}
            onCheckedChange={(v) => onChange({ ...state, create_role: v })}
          />
          <SwitchRow
            label="Replication"
            checked={state.replication}
            onCheckedChange={(v) => onChange({ ...state, replication: v })}
          />
          <SwitchRow
            label="Bypass RLS"
            checked={state.bypass_rls}
            onCheckedChange={(v) => onChange({ ...state, bypass_rls: v })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Verbindung</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="conn-limit" className="text-xs">
              Connection Limit
            </Label>
            <Input
              id="conn-limit"
              type="number"
              min={-1}
              placeholder="-1 = Unbegrenzt"
              value={state.conn_limit}
              onChange={(e) => onChange({ ...state, conn_limit: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="valid-until" className="text-xs">
              Gültig bis
            </Label>
            <Input
              id="valid-until"
              type="datetime-local"
              value={state.valid_until}
              onChange={(e) => onChange({ ...state, valid_until: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Passwort</h3>
        <div className="max-w-xs">
          <Input
            type="password"
            placeholder="Neues Passwort (leer = unverändert)"
            value={state.password}
            onChange={(e) => onChange({ ...state, password: e.target.value })}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Mitgliedschaften</h3>
        {otherRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Keine anderen Rollen vorhanden.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {otherRoles.map((r) => {
              const isMember = effectiveMemberships.has(r.name);
              return (
                <button
                  key={r.name}
                  type="button"
                  onClick={() => toggleMembership(r.name)}
                  className="inline-flex items-center gap-1"
                >
                  <Badge variant={isMember ? "default" : "outline"}>
                    {isMember && <CheckIcon className="size-3" />}
                    {r.name}
                  </Badge>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  allRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allRoles: RoleInfo[];
}) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateFormState>(defaultCreateForm);

  const handleCreate = useCallback(async () => {
    if (!connection || !form.name.trim()) return;
    setCreating(true);
    try {
      const options: CreateRoleOptions = {
        name: form.name.trim(),
        password: form.password || undefined,
        superuser: form.superuser,
        can_login: form.can_login,
        create_db: form.create_db,
        create_role: form.create_role,
        replication: form.replication,
        bypass_rls: form.bypass_rls,
        conn_limit: form.conn_limit !== "" ? Number(form.conn_limit) : undefined,
        valid_until: form.valid_until || undefined,
        member_of: form.member_of,
      };
      await createRole(
        connection.kind,
        effectiveConnectionString(connection),
        options,
        database ?? undefined,
      );
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast.success(`Rolle "${form.name}" erstellt`);
      onOpenChange(false);
      setForm(defaultCreateForm);
      navigate({ to: "/users/$name", params: { name: form.name.trim() } });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  }, [connection, database, form, queryClient, onOpenChange, navigate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neue Rolle erstellen</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-name" className="text-xs">
              Name
            </Label>
            <Input
              id="create-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Rollenname"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-password" className="text-xs">
              Passwort
            </Label>
            <Input
              id="create-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Optional"
            />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <SwitchRow
              label="Login"
              checked={form.can_login}
              onCheckedChange={(v) => setForm({ ...form, can_login: v })}
            />
            <SwitchRow
              label="Superuser"
              checked={form.superuser}
              onCheckedChange={(v) => setForm({ ...form, superuser: v })}
            />
            <SwitchRow
              label="Create DB"
              checked={form.create_db}
              onCheckedChange={(v) => setForm({ ...form, create_db: v })}
            />
            <SwitchRow
              label="Create Role"
              checked={form.create_role}
              onCheckedChange={(v) => setForm({ ...form, create_role: v })}
            />
            <SwitchRow
              label="Replication"
              checked={form.replication}
              onCheckedChange={(v) => setForm({ ...form, replication: v })}
            />
            <SwitchRow
              label="Bypass RLS"
              checked={form.bypass_rls}
              onCheckedChange={(v) => setForm({ ...form, bypass_rls: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-conn-limit" className="text-xs">
                Connection Limit
              </Label>
              <Input
                id="create-conn-limit"
                type="number"
                min={-1}
                placeholder="-1 = Unbegrenzt"
                value={form.conn_limit}
                onChange={(e) => setForm({ ...form, conn_limit: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-valid-until" className="text-xs">
                Gültig bis
              </Label>
              <Input
                id="create-valid-until"
                type="datetime-local"
                value={form.valid_until}
                onChange={(e) => setForm({ ...form, valid_until: e.target.value })}
              />
            </div>
          </div>
          {allRoles.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Mitglied von</Label>
              <div className="flex flex-wrap gap-1.5">
                {allRoles.map((r) => {
                  const selected = form.member_of.includes(r.name);
                  return (
                    <button
                      key={r.name}
                      type="button"
                      onClick={() =>
                        setForm({
                          ...form,
                          member_of: selected
                            ? form.member_of.filter((n) => n !== r.name)
                            : [...form.member_of, r.name],
                        })
                      }
                    >
                      <Badge variant={selected ? "default" : "outline"}>
                        {selected && <CheckIcon className="size-3" />}
                        {r.name}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setForm(defaultCreateForm);
            }}
          >
            Abbrechen
          </Button>
          <Button onClick={handleCreate} disabled={creating || !form.name.trim()}>
            {creating ? (
              <LoaderIcon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
            Erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface CreateFormState {
  name: string;
  password: string;
  superuser: boolean;
  can_login: boolean;
  create_db: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: string;
  valid_until: string;
  member_of: string[];
}

const defaultCreateForm: CreateFormState = {
  name: "",
  password: "",
  superuser: false,
  can_login: true,
  create_db: false,
  create_role: false,
  replication: false,
  bypass_rls: false,
  conn_limit: "",
  valid_until: "",
  member_of: [],
};

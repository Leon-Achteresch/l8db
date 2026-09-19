import { useQueryClient } from "@tanstack/react-query";

import { useNavigate } from "@tanstack/react-router";
import { Check, Loader, Shield, User } from "lucide";
import {
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
  UndoIcon,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { useCallback, useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { CreateRoleDialog } from "@/features/users/users-view/create-role-dialog";
import { RoleDetailView } from "@/features/users/users-view/role-detail-view";
import { RoleEditForm } from "@/features/users/users-view/role-edit-form";
import { toggleMembershipState } from "@/features/users/users-view/toggle-membership";
import type { EditFormState } from "@/features/users/users-view/types";
import { useActiveConnection } from "@/lib/connections";
import { type AlterRoleOptions, alterRole, dropRole } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useRolesQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

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
      setEditState(toggleMembershipState(editState, roleName));
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
          <MorphIcon
            icon={role.can_login ? User : Shield}
            className="size-4 shrink-0 text-muted-foreground"
          />
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
              <MorphIcon
                icon={saving ? Loader : Check}
                data-icon="inline-start"
                className={cn(saving && "animate-spin")}
              />
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

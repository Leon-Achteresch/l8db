import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  type WorkspaceUser,
  workspaceDisconnect,
  workspaceLocalStatus,
  workspaceLocalStop,
  workspaceProfiles,
  workspaceRequest,
} from "@/lib/db/workspaces";
import { WorkspaceAudit } from "./workspace-audit";
import { WorkspaceConnections } from "./workspace-connections";
import { WorkspaceInvitations } from "./workspace-invitations";
import { WorkspaceLogin } from "./workspace-login";
import { WorkspacePending } from "./workspace-pending";
import { WorkspaceQueries } from "./workspace-queries";
import { WorkspaceUsers } from "./workspace-users";

export function WorkspacesPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profiles = useQuery({
    queryKey: ["workspace-profiles"],
    queryFn: workspaceProfiles,
    retry: false,
  });
  const profile = profiles.data?.find((item) => item.id === selected) ?? profiles.data?.[0];
  const account = useQuery({
    queryKey: ["workspace", profile?.id, "me"],
    queryFn: () => workspaceRequest<WorkspaceUser>(profile?.id ?? "", "GET", "me"),
    enabled: Boolean(profile),
    retry: false,
  });
  const local = useQuery({
    queryKey: ["workspace-local"],
    queryFn: workspaceLocalStatus,
    retry: false,
  });
  const current =
    profile && account.isSuccess && account.data ? { ...profile, user: account.data } : null;

  async function disconnect() {
    if (!profile) return;
    setError(null);
    try {
      await workspaceDisconnect(profile.id);
    } catch (cause) {
      setError(String(cause));
    }
    queryClient.removeQueries({ queryKey: ["workspace", profile.id] });
    await queryClient.invalidateQueries({ queryKey: ["workspace-profiles"] });
  }

  return (
    <div className="flex flex-col">
      <header className="mb-6 flex flex-wrap items-center gap-2">
        {profiles.data && profiles.data.length > 0 && (
          <>
            <Select
              value={profile?.id ?? ""}
              onValueChange={(id) => {
                setSelected(id);
                setError(null);
              }}
            >
              <SelectTrigger className="max-w-80" aria-label="Team-Workspace">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profiles.data.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.user.email} · {item.endpoint}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: ["workspace", profile?.id] })
              }
            >
              <RefreshCw className="size-3.5" />
              Aktualisieren
            </Button>
            <Button variant="outline" size="sm" onClick={() => void disconnect()}>
              Abmelden
            </Button>
          </>
        )}
        <Button size="sm" onClick={() => setAdding((value) => !value)}>
          Workspace hinzufügen
        </Button>
      </header>
      {(error || profiles.isError) && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {error || String(profiles.error)}
        </p>
      )}
      {(adding || !profile) && (
        <div className="mb-6">
          <WorkspaceLogin
            onConnect={(next) => {
              setSelected(next.id);
              setAdding(false);
              void queryClient.invalidateQueries({ queryKey: ["workspace-profiles"] });
              void queryClient.invalidateQueries({ queryKey: ["workspace", next.id] });
              void queryClient.invalidateQueries({ queryKey: ["workspace-local"] });
            }}
          />
        </div>
      )}
      {profile && account.isPending && <p role="status">Workspace-Rechte werden geprüft…</p>}
      {account.isError && (
        <p role="alert" className="text-sm text-destructive">
          {String(account.error)}
        </p>
      )}
      {current && (
        <Tabs key={`${current.id}-${current.user.role}`} defaultValue="connections">
          <TabsList className="mb-5 flex h-auto flex-wrap justify-start">
            <TabsTrigger value="connections">Verbindungen</TabsTrigger>
            <TabsTrigger value="queries">Gemeinsame SQL</TabsTrigger>
            <TabsTrigger value="pending">Freigaben</TabsTrigger>
            {current.user.role === "admin" && (
              <>
                <TabsTrigger value="users">Benutzer und Rechte</TabsTrigger>
                <TabsTrigger value="invitations">Einladungen</TabsTrigger>
                <TabsTrigger value="audit">Audit</TabsTrigger>
              </>
            )}
          </TabsList>
          <TabsContent value="connections">
            <WorkspaceConnections profile={current} />
          </TabsContent>
          <TabsContent value="queries">
            <WorkspaceQueries profile={current} />
          </TabsContent>
          <TabsContent value="pending">
            <WorkspacePending profile={current} />
          </TabsContent>
          {current.user.role === "admin" && (
            <>
              <TabsContent value="users">
                <WorkspaceUsers profile={current} />
              </TabsContent>
              <TabsContent value="invitations">
                <WorkspaceInvitations profile={current} />
              </TabsContent>
              <TabsContent value="audit">
                <WorkspaceAudit profile={current} />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
      {local.data && (
        <footer className="mt-8 flex flex-wrap items-center gap-3 border-t pt-4 text-xs text-muted-foreground">
          <p className="flex-1">
            Lokaler Workspace: {local.data.endpoint} · Daten: {local.data.root}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void workspaceLocalStop()
                .then(() => queryClient.invalidateQueries({ queryKey: ["workspace-local"] }))
                .catch((cause) => setError(String(cause)));
            }}
          >
            Lokalen Server stoppen
          </Button>
        </footer>
      )}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  CLOUD_QUERY_OPTIONS,
  type NeonBranch,
  type NeonProject,
  type NeonTransport,
  neonCreateConnection,
  neonDatabases,
  neonRoles,
} from "@/lib/db/cloud-accounts";
import { addCloudConnection, cloudErrorText } from "./add-cloud-connection";
import { CloudField } from "./cloud-field";
import { CloudSectionError } from "./cloud-section-error";

export function NeonConnectPanel({
  accountId,
  project,
  branch,
}: {
  accountId: string;
  project: NeonProject;
  branch: NeonBranch;
}) {
  const scope = ["cloud-accounts", accountId, "neon", project.id, branch.id] as const;
  const databases = useQuery({
    queryKey: [...scope, "databases"],
    queryFn: () => neonDatabases(accountId, project.id, branch.id),
    ...CLOUD_QUERY_OPTIONS,
  });
  const roles = useQuery({
    queryKey: [...scope, "roles"],
    queryFn: () => neonRoles(accountId, project.id, branch.id),
    ...CLOUD_QUERY_OPTIONS,
  });
  const [database, setDatabase] = useState("");
  const [role, setRole] = useState("");
  const [pooled, setPooled] = useState(false);
  const [transport, setTransport] = useState<NeonTransport>("tcp");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const first = databases.data?.[0];
    if (!first) return;
    setDatabase((current) => current || first.name);
    setRole((current) => current || first.owner_name);
  }, [databases.data]);

  const resolvedName = name.trim() || `${project.name} / ${branch.name} / ${database}`;

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const created = await neonCreateConnection(accountId, {
        projectId: project.id,
        branchId: branch.id,
        database,
        role,
        pooled,
        transport,
        name: resolvedName,
      });
      addCloudConnection(created);
      setName("");
    } catch (reason) {
      setError(cloudErrorText(reason));
      toast.error("Verbindung konnte nicht angelegt werden");
    } finally {
      setBusy(false);
    }
  }

  if (databases.isError) {
    return <CloudSectionError error={databases.error} onRetry={() => void databases.refetch()} />;
  }

  return (
    <form
      className="flex max-w-xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void connect();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Legt eine gespeicherte PostgreSQL-Verbindung an. Das Rollenpasswort holt l8db direkt bei
        Neon und speichert es nur im Schlüsselbund.
      </p>
      <CloudField id="neon-connect-db" label="Datenbank">
        <Select value={database} onValueChange={setDatabase} disabled={databases.isLoading}>
          <SelectTrigger id="neon-connect-db">
            <SelectValue placeholder={databases.isLoading ? "Lade…" : "Datenbank wählen"} />
          </SelectTrigger>
          <SelectContent>
            {databases.data?.map((entry) => (
              <SelectItem key={entry.name} value={entry.name}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CloudField>
      <CloudField id="neon-connect-role" label="Rolle">
        <Select value={role} onValueChange={setRole} disabled={roles.isLoading}>
          <SelectTrigger id="neon-connect-role">
            <SelectValue placeholder={roles.isLoading ? "Lade…" : "Rolle wählen"} />
          </SelectTrigger>
          <SelectContent>
            {roles.data
              ?.filter((entry) => !entry.protected)
              .map((entry) => (
                <SelectItem key={entry.name} value={entry.name}>
                  {entry.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </CloudField>
      {roles.isError && <CloudSectionError error={roles.error} />}
      <CloudField
        id="neon-connect-transport"
        label="Transport"
        hint={
          transport === "neon-ws"
            ? "WebSocket nutzt Port 443 mit geprüfter HTTPS-Verschlüsselung. PostgreSQL-Channel-Binding wird für diesen Transport deaktiviert."
            : "WebSocket nutzt nur Port 443 und hilft in Netzen, die Port 5432 sperren."
        }
      >
        <Select value={transport} onValueChange={(value) => setTransport(value as NeonTransport)}>
          <SelectTrigger id="neon-connect-transport">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tcp">PostgreSQL-Protokoll (Port 5432)</SelectItem>
            <SelectItem value="neon-ws">WebSocket über HTTPS (Port 443)</SelectItem>
          </SelectContent>
        </Select>
      </CloudField>
      <div className="flex items-center gap-2 text-sm">
        <Switch id="neon-connect-pooled" checked={pooled} onCheckedChange={setPooled} />
        <label htmlFor="neon-connect-pooled">Verbindungspooler (PgBouncer) verwenden</label>
      </div>
      <CloudField id="neon-connect-name" label="Name der Verbindung">
        <Input
          id="neon-connect-name"
          value={name}
          placeholder={resolvedName}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
      </CloudField>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="self-start" disabled={busy || !database || !role}>
        {busy ? "Lege an…" : "Verbindung anlegen"}
      </Button>
    </form>
  );
}

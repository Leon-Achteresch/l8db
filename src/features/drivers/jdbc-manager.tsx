import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, FolderOpen, Plus, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useConnectionsStore } from "@/lib/connections";
import {
  type JdbcProfile,
  type JdbcProfileInput,
  jdbcCatalog,
  jdbcCloseProfile,
  jdbcConnectionString,
  jdbcImportJar,
  jdbcProfiles,
  jdbcRemoveJar,
  jdbcRemoveProfile,
  jdbcSaveProfile,
  jdbcStatus,
} from "@/lib/db/jdbc";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const EMPTY: JdbcProfileInput = {
  name: "",
  driverClass: "",
  jars: [],
  url: "jdbc:",
  username: "",
  readOnly: true,
  password: null,
};

export function JdbcManager() {
  const client = useQueryClient();
  const badge = useNewFeatureVisibility<HTMLElement>("drivers.jdbc");
  const status = useQuery({ queryKey: ["jdbc", "status"], queryFn: jdbcStatus, retry: false });
  const profiles = useQuery({
    queryKey: ["jdbc", "profiles"],
    queryFn: jdbcProfiles,
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ["jdbc", "catalog"],
    queryFn: jdbcCatalog,
    staleTime: Infinity,
  });
  const [input, setInput] = useState<JdbcProfileInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [remove, setRemove] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ["jdbc"] });

  async function action(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
      await refresh();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  }

  function connect(profile: JdbcProfile) {
    const connectionString = jdbcConnectionString(profile.id);
    const store = useConnectionsStore.getState();
    const existing = store.connections.find(
      (connection) =>
        connection.kind === "jdbc" && connection.connectionString === connectionString,
    );
    if (existing)
      store.updateConnection(existing.id, {
        ...existing,
        name: profile.name,
        readOnly: profile.readOnly,
      });
    else
      store.addConnection({
        name: profile.name,
        kind: "jdbc",
        connectionString,
        sslMode: "prefer",
        readOnly: profile.readOnly,
      });
    toast.success(`„${profile.name}“ ist in den Verbindungen verfügbar.`);
  }

  return (
    <section
      ref={badge.ref}
      className="mt-8 space-y-4 rounded-xl border bg-card p-5"
      aria-label="JDBC-Treiber"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Database className="size-4" />
        <h2 className="font-semibold">JDBC-Treiber und Verbindungen</h2>
        {badge.isNew && <NewBadge />}
        <Button
          className="ml-auto"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw className="size-3.5" />
          Aktualisieren
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() =>
            void action(async () => {
              await jdbcImportJar();
            })
          }
        >
          <FolderOpen className="size-3.5" />
          JAR importieren
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setInput({ ...EMPTY, jars: [] })}>
          <Plus className="size-3.5" />
          Profil anlegen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {status.data?.detail ?? "Java-Laufzeit wird geprüft …"} Importiere ausschließlich
        vertrauenswürdige Hersteller-JARs; Treiber führen lokalen Code aus. Profile speichern
        Passwörter im Betriebssystem-Schlüsselbund.
      </p>
      {(status.error || profiles.error) && (
        <p role="alert" className="text-sm text-destructive">
          {String(status.error ?? profiles.error)}
        </p>
      )}
      {status.data && (
        <p className="text-xs text-muted-foreground">
          {status.data.jars.length} JARs · höchstens {status.data.maxProcesses} Prozesse · Trennung
          nach {status.data.idleSeconds} Sekunden Leerlauf
        </p>
      )}
      {status.data && status.data.jars.length > 0 && (
        <details className="rounded-lg border p-3 text-xs">
          <summary className="cursor-pointer font-medium">Importierte JAR-Dateien</summary>
          <ul className="mt-2 space-y-2">
            {status.data.jars.map((jar) => (
              <li key={jar.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={`SHA-256: ${jar.id}`}>
                  {jar.name}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`${jar.name} löschen`}
                  disabled={busy || profiles.data?.some((profile) => profile.jars.includes(jar.id))}
                  onClick={() => void action(() => jdbcRemoveJar(jar.id))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {profiles.isPending && <Spinner className="size-4" />}
      <div className="space-y-2">
        {profiles.data?.map((profile) => (
          <article
            key={profile.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{profile.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {profile.driverClass} · {profile.readOnly ? "Lesemodus" : "Lesen und Schreiben"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !status.data?.available}
              onClick={() => connect(profile)}
            >
              Verbindung hinzufügen
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setInput({ ...profile, password: null })}
            >
              Bearbeiten
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${profile.name} trennen`}
              disabled={busy}
              onClick={() => void action(() => jdbcCloseProfile(profile.id))}
            >
              <Unplug className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`${profile.name} entfernen`}
              disabled={busy}
              onClick={() => setRemove(profile.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </article>
        ))}
      </div>
      {remove && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 p-3 text-sm"
        >
          Profil, gespeichertes Passwort und zugehörige Verbindungen entfernen? Vorhandene
          Datenbankdateien bleiben erhalten.
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await jdbcRemoveProfile(remove);
                const store = useConnectionsStore.getState();
                for (const connection of store.connections.filter(
                  (connection) =>
                    connection.kind === "jdbc" &&
                    connection.connectionString === jdbcConnectionString(remove),
                ))
                  store.removeConnection(connection.id);
                setRemove(null);
              })
            }
          >
            Entfernen
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRemove(null)}>
            Abbrechen
          </Button>
        </div>
      )}
      {input && (
        <form
          className="grid gap-4 rounded-lg border p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void action(async () => {
              await jdbcSaveProfile(input);
              setInput(null);
              toast.success("JDBC-Profil gespeichert");
            });
          }}
        >
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="jdbc-catalog">Vorlage</Label>
            <Select
              onValueChange={(id) => {
                const item = catalog.data?.find((item) => item.id === id);
                if (item)
                  setInput({
                    ...input,
                    driverClass: item.driverClass,
                    url: item.urlTemplate,
                    name: input.name || item.name,
                  });
              }}
            >
              <SelectTrigger id="jdbc-catalog">
                <SelectValue placeholder="Treiber auswählen" />
              </SelectTrigger>
              <SelectContent>
                {catalog.data?.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {catalog.data?.find((item) => item.driverClass === input.driverClass)
              ?.documentation && (
              <a
                className="text-xs text-primary underline underline-offset-2"
                href={
                  catalog.data.find((item) => item.driverClass === input.driverClass)?.documentation
                }
                target="_blank"
                rel="noreferrer"
              >
                Treiber und Dokumentation beim Hersteller
              </a>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="jdbc-name">Name</Label>
            <Input
              id="jdbc-name"
              required
              maxLength={120}
              value={input.name}
              onChange={(event) => setInput({ ...input, name: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="jdbc-class">Treiberklasse</Label>
            <Input
              id="jdbc-class"
              required
              value={input.driverClass}
              onChange={(event) => setInput({ ...input, driverClass: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5 md:col-span-2">
            <Label htmlFor="jdbc-url">JDBC-URL ohne Anmeldedaten</Label>
            <Input
              id="jdbc-url"
              required
              value={input.url}
              onChange={(event) => setInput({ ...input, url: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="jdbc-user">Benutzer</Label>
            <Input
              id="jdbc-user"
              autoComplete="off"
              value={input.username}
              onChange={(event) => setInput({ ...input, username: event.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="jdbc-password">
              Passwort {input.id ? "(leer lassen zum Beibehalten)" : ""}
            </Label>
            <Input
              id="jdbc-password"
              type="password"
              autoComplete="new-password"
              value={input.password ?? ""}
              onChange={(event) => setInput({ ...input, password: event.target.value || null })}
            />
          </div>
          <fieldset className="space-y-2 md:col-span-2">
            <legend className="mb-2 text-sm font-medium">Importierte JARs</legend>
            {status.data?.jars.map((jar) => (
              <label key={jar.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={input.jars.includes(jar.id)}
                  onCheckedChange={(checked) =>
                    setInput({
                      ...input,
                      jars: checked
                        ? [...input.jars, jar.id]
                        : input.jars.filter((id) => id !== jar.id),
                    })
                  }
                />
                {jar.name}
              </label>
            ))}
            {status.data?.jars.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Zuerst die Hersteller-JAR importieren. JDBC-Treiber können mehrere JARs benötigen.
              </p>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <Checkbox
              checked={input.readOnly}
              onCheckedChange={(value) => setInput({ ...input, readOnly: Boolean(value) })}
            />
            Nur lesende SQL-Anweisungen erlauben
          </label>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={busy || input.jars.length === 0}>
              {busy && <Spinner className="size-3.5" />}Speichern
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setInput(null)}>
              Abbrechen
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}

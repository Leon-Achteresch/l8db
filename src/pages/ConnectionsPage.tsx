import { useState } from "react";
import {
  CheckIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useActiveConnection,
  useConnectionsStore,
  type SavedConnection,
} from "@/lib/connections";
import { type DatabaseKind, testConnectionString } from "@/lib/db";

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success" }
  | { status: "error"; message: string };

type EditorMode = "string" | "fields";

interface FormState {
  name: string;
  kind: DatabaseKind;
  mode: EditorMode;
  connectionString: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const emptyForm: FormState = {
  name: "",
  kind: "postgres",
  mode: "string",
  connectionString: "",
  host: "localhost",
  port: 5432,
  user: "postgres",
  password: "",
  database: "postgres",
};

function buildConnectionString(form: FormState): string {
  if (form.mode === "string") {
    return form.connectionString.trim();
  }
  const auth = form.password
    ? `${encodeURIComponent(form.user)}:${encodeURIComponent(form.password)}`
    : encodeURIComponent(form.user);
  return `postgresql://${auth}@${form.host}:${form.port}/${form.database}`;
}

export function ConnectionsPage() {
  const connections = useConnectionsStore((state) => state.connections);
  const addConnection = useConnectionsStore((state) => state.addConnection);
  const updateConnection = useConnectionsStore(
    (state) => state.updateConnection,
  );
  const removeConnection = useConnectionsStore(
    (state) => state.removeConnection,
  );
  const setActiveId = useConnectionsStore((state) => state.setActiveId);
  const activeConnection = useActiveConnection();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [state, setState] = useState<TestState>({ status: "idle" });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setState({ status: "idle" });
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setState({ status: "idle" });
  }

  function startEdit(connection: SavedConnection) {
    setEditingId(connection.id);
    setForm({
      ...emptyForm,
      name: connection.name,
      kind: connection.kind,
      mode: "string",
      connectionString: connection.connectionString,
    });
    setState({ status: "idle" });
  }

  async function handleTest() {
    const connectionString = buildConnectionString(form);
    if (!connectionString) {
      setState({ status: "error", message: "Connection-String fehlt." });
      return;
    }
    setState({ status: "testing" });
    try {
      await testConnectionString(form.kind, connectionString);
      setState({ status: "success" });
    } catch (error) {
      setState({ status: "error", message: String(error) });
    }
  }

  function handleSave() {
    const name = form.name.trim();
    const connectionString = buildConnectionString(form);
    if (!name || !connectionString) {
      setState({
        status: "error",
        message: "Name und Connection-String sind erforderlich.",
      });
      return;
    }
    const input = { name, kind: form.kind, connectionString };
    if (editingId) {
      updateConnection(editingId, input);
    } else {
      addConnection(input);
    }
    resetForm();
  }

  return (
    <main className="mx-auto grid w-full max-w-xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Verbindungen</CardTitle>
          <CardDescription>
            Gespeicherte Datenbankverbindungen verwalten.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Verbindungen gespeichert.
            </p>
          ) : (
            connections.map((connection) => (
              <div
                key={connection.id}
                className="flex items-center gap-2 rounded-md border p-3"
              >
                <div className="grid flex-1 gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{connection.name}</span>
                    {connection.id === activeConnection?.id ? (
                      <Badge variant="secondary">Aktiv</Badge>
                    ) : null}
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {connection.connectionString}
                  </span>
                </div>
                {connection.id === activeConnection?.id ? null : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setActiveId(connection.id)}
                    aria-label="Aktivieren"
                  >
                    <CheckIcon />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startEdit(connection)}
                  aria-label="Bearbeiten"
                >
                  <PencilIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    removeConnection(connection.id);
                    if (editingId === connection.id) resetForm();
                  }}
                  aria-label="Löschen"
                >
                  <TrashIcon />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {editingId ? "Verbindung bearbeiten" : "Verbindung hinzufügen"}
          </CardTitle>
          <CardDescription>
            Per Connection-String oder Einzelfeldern eingeben und testen.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Lokale Datenbank"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="kind">Datenbank</Label>
            <Select
              value={form.kind}
              onValueChange={(value) => update("kind", value as DatabaseKind)}
            >
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="postgres">PostgreSQL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Tabs
            value={form.mode}
            onValueChange={(value) => update("mode", value as EditorMode)}
          >
            <TabsList>
              <TabsTrigger value="string">Connection-String</TabsTrigger>
              <TabsTrigger value="fields">Felder</TabsTrigger>
            </TabsList>
            <TabsContent value="string" className="grid gap-2">
              <Label htmlFor="connectionString">Connection-String</Label>
              <Input
                id="connectionString"
                value={form.connectionString}
                onChange={(event) =>
                  update("connectionString", event.target.value)
                }
                placeholder="postgresql://user:password@localhost:5432/postgres"
              />
            </TabsContent>
            <TabsContent value="fields" className="grid gap-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2 grid gap-2">
                  <Label htmlFor="host">Host</Label>
                  <Input
                    id="host"
                    value={form.host}
                    onChange={(event) => update("host", event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="port">Port</Label>
                  <Input
                    id="port"
                    type="number"
                    value={form.port}
                    onChange={(event) =>
                      update("port", Number(event.target.value) || 0)
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="database">Datenbank-Name</Label>
                <Input
                  id="database"
                  value={form.database}
                  onChange={(event) => update("database", event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="user">Benutzer</Label>
                  <Input
                    id="user"
                    value={form.user}
                    onChange={(event) => update("user", event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="password">Passwort</Label>
                  <Input
                    id="password"
                    type="password"
                    value={form.password}
                    onChange={(event) => update("password", event.target.value)}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {state.status === "success" ? (
            <p className="text-sm text-emerald-600">Verbindung erfolgreich.</p>
          ) : null}
          {state.status === "error" ? (
            <p className="text-sm text-destructive">{state.message}</p>
          ) : null}
        </CardContent>
        <CardFooter className="gap-2">
          <Button onClick={handleSave}>
            {editingId ? <CheckIcon /> : <PlusIcon />}
            {editingId ? "Speichern" : "Hinzufügen"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={state.status === "testing"}
          >
            {state.status === "testing" ? <Spinner /> : null}
            Verbindung testen
          </Button>
          {editingId ? (
            <Button variant="ghost" onClick={resetForm}>
              <XIcon />
              Abbrechen
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </main>
  );
}

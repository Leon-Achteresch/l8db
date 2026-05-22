import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
  PlugZap,
  Lock,
  AlertCircle,
} from "lucide-react";
import postgresql from "thesvg/postgresql";
import mysql from "thesvg/mysql";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useActiveConnection,
  useConnectionsStore,
  TAG_COLORS,
  type ConnectionTag,
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
  tags: ConnectionTag[];
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
  tags: [],
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

function maskConnectionString(str: string): string {
  if (!str) return "";
  try {
    const url = new URL(str);
    if (url.password) {
      url.password = "••••••••";
    }
    return url.toString();
  } catch {
    return str.replace(/:([^:@]+)@/, ":••••••••@");
  }
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
  const [tagInput, setTagInput] = useState("");
  const [tagColor, setTagColor] = useState(TAG_COLORS[0]);

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
      tags: connection.tags ?? [],
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
    const input = { name, kind: form.kind, connectionString, tags: form.tags };
    if (editingId) {
      updateConnection(editingId, input);
    } else {
      addConnection(input);
    }
    resetForm();
  }

  return (
    <div className="h-full w-full overflow-x-hidden overflow-y-auto bg-background/10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-8 md:px-10">
        <header className="shrink-0 border-b border-border/20 pb-6">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                asChild
                className="h-9 w-9 shrink-0 rounded-xl border border-border/40 bg-background/40 hover:bg-accent"
              >
                <Link to="/">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                Datenbank-Verbindungen
              </h1>
            </div>
            <p className="text-sm text-muted-foreground pl-12">
              Verwalte deine aktiven Verbindungen und füge neue SQL-Datenbanken hinzu.
            </p>
          </div>
        </header>

        <div className="grid w-full min-w-0 grid-cols-1 gap-10 xl:grid-cols-2 xl:gap-12">
          <section className="flex min-w-0 flex-col gap-4 overflow-hidden">
            <div className="shrink-0 space-y-0.5 border-b border-border/10 pb-4">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                Gespeicherte Verbindungen
                <Badge
                  variant="secondary"
                  className="rounded-full px-2 py-0.5 text-xs font-normal"
                >
                  {connections.length}
                </Badge>
              </h2>
              <p className="text-xs text-muted-foreground">
                Klicke auf eine Verbindung, um sie zu aktivieren.
              </p>
            </div>

            <div className="min-w-0 divide-y divide-border/10">
              {connections.length === 0 ? (
                <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
                  <div
                    className="mb-3 size-10 shrink-0 overflow-hidden text-muted-foreground/30 [&_svg]:block [&_svg]:size-full"
                    dangerouslySetInnerHTML={{ __html: postgresql.svg }}
                    style={{ filter: "grayscale(100%) opacity(40%)" }}
                  />
                  <p className="text-sm font-medium text-muted-foreground">
                    Noch keine Verbindungen
                  </p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground/70">
                    Trage unten deine Verbindungsdaten ein, um dich mit einer
                    Datenbank zu verbinden.
                  </p>
                </div>
              ) : (
                connections.map((connection) => {
                  const isActive = connection.id === activeConnection?.id;
                  const isEditing = connection.id === editingId;
                  const isPostgres = connection.kind === "postgres";
                  const rowHighlight = isActive
                    ? "border-l-2 border-emerald-500 bg-emerald-500/[0.03] pl-3"
                    : isEditing
                      ? "border-l-2 border-primary bg-primary/[0.02] pl-3"
                      : "border-l-2 border-transparent pl-3 hover:bg-muted/40";
                  return (
                    <div
                      key={connection.id}
                      className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-3 gap-y-1 py-3 pr-1 transition-colors ${rowHighlight}`}
                    >
                      <div
                        className="row-span-2 size-10 shrink-0 overflow-hidden rounded-lg border border-border/20 bg-background/50 p-1.5 [&_svg]:block [&_svg]:size-full"
                        style={{
                          color: isPostgres
                            ? `#${postgresql.hex}`
                            : `#${mysql.hex}`,
                        }}
                        dangerouslySetInnerHTML={{
                          __html: isPostgres ? postgresql.svg : mysql.svg,
                        }}
                      />
                      <div className="col-start-2 flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold">
                          {connection.name}
                        </span>
                        {connection.tags?.map((tag, index) => (
                          <span
                            key={index}
                            className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                            style={{ backgroundColor: tag.color }}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {isActive ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            <span className="relative flex size-1.5 rounded-full bg-emerald-500">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                            </span>
                            Aktiv
                          </span>
                        ) : null}
                      </div>
                      <div className="col-start-3 row-span-2 flex shrink-0 items-center gap-0.5 self-center">
                        {!isActive ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0 rounded-lg hover:bg-emerald-500/10 hover:text-emerald-600"
                            onClick={() => setActiveId(connection.id)}
                            title="Aktivieren"
                          >
                            <Check className="size-4" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`size-8 shrink-0 rounded-lg ${
                            isEditing
                              ? "bg-primary/10 text-primary"
                              : "hover:bg-primary/10 hover:text-primary"
                          }`}
                          onClick={() => startEdit(connection)}
                          title="Bearbeiten"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 rounded-lg hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => {
                            removeConnection(connection.id);
                            if (editingId === connection.id) resetForm();
                          }}
                          title="Löschen"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <p className="col-start-2 min-w-0 truncate font-mono text-[10px] text-muted-foreground/75">
                        {maskConnectionString(connection.connectionString)}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-6 overflow-hidden">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
                <PlugZap className="h-5 w-5 text-primary" />
                {editingId ? "Verbindung bearbeiten" : "Neue Verbindung einrichten"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Gib die Verbindungsdaten manuell ein oder verwende einen Connection-String.
              </p>
            </div>

            <div className="space-y-6 w-full">
              <div className="grid gap-2">
                <Label htmlFor="name" className="text-sm font-medium">
                  Verbindungs-Name
                </Label>
                <Input
                  id="name"
                  value={form.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="z. B. Produktions-Datenbank"
                  className="h-10 border-border/40 bg-background/20 focus-visible:ring-primary/20 focus-visible:border-primary rounded-xl"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-sm font-medium">Tags</Label>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        {tag.name}
                        <button
                          type="button"
                          className="ml-0.5 inline-flex size-3.5 items-center justify-center rounded-full hover:bg-white/20"
                          onClick={() =>
                            update(
                              "tags",
                              form.tags.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <X className="size-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`size-5 rounded-full border-2 transition-all ${
                          tagColor === color
                            ? "border-foreground scale-110"
                            : "border-transparent hover:scale-110"
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => setTagColor(color)}
                      />
                    ))}
                  </div>
                  <Input
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const trimmed = tagInput.trim();
                        if (trimmed) {
                          update("tags", [
                            ...form.tags,
                            { name: trimmed, color: tagColor },
                          ]);
                          setTagInput("");
                        }
                      }
                    }}
                    placeholder="Tag-Name + Enter"
                    className="h-8 flex-1 border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl border-border/40 text-xs"
                    onClick={() => {
                      const trimmed = tagInput.trim();
                      if (trimmed) {
                        update("tags", [
                          ...form.tags,
                          { name: trimmed, color: tagColor },
                        ]);
                        setTagInput("");
                      }
                    }}
                  >
                    <Plus className="size-3" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-medium">Datenbank-Typ</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={() => update("kind", "postgres")}
                    className={`relative flex items-center gap-4 rounded-xl border p-4 text-left transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                      form.kind === "postgres"
                        ? "border-primary bg-primary/[0.02] shadow-[0_0_12px_rgba(var(--primary),0.03)]"
                        : "border-border/40 bg-background/20 hover:bg-accent/40"
                    }`}
                  >
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-1.5 bg-background/50 border border-border/10 [&_svg]:h-full [&_svg]:w-full"
                      style={{ color: `#${postgresql.hex}` }}
                      dangerouslySetInnerHTML={{ __html: postgresql.svg }}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm">PostgreSQL</div>
                      <div className="text-xs text-muted-foreground truncate">
                        Standard relationale SQL-Datenbank
                      </div>
                    </div>
                    {form.kind === "postgres" && (
                      <span className="absolute top-3 right-3 flex h-2 w-2 rounded-full bg-primary" />
                    )}
                  </button>

                  <div className="relative flex items-center gap-4 rounded-xl border border-dashed border-border/40 bg-muted/10 p-4 text-left opacity-60">
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg p-1.5 bg-background/50 border border-border/10 grayscale opacity-70 [&_svg]:h-full [&_svg]:w-full"
                      style={{ color: `#${mysql.hex}` }}
                      dangerouslySetInnerHTML={{ __html: mysql.svg }}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm flex items-center gap-1.5">
                        MySQL
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1.5 py-0 font-normal leading-normal bg-background/50 rounded-full"
                        >
                          Soon
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        Demnächst unterstützt
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <Tabs
                value={form.mode}
                onValueChange={(value) => update("mode", value as EditorMode)}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2 bg-muted/30 p-1 rounded-xl h-10 border border-border/20">
                  <TabsTrigger
                    value="string"
                    className="rounded-lg text-xs font-medium py-1.5"
                  >
                    Connection-String
                  </TabsTrigger>
                  <TabsTrigger
                    value="fields"
                    className="rounded-lg text-xs font-medium py-1.5"
                  >
                    Einzelne Felder
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="string" className="mt-4 space-y-3">
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="connectionString"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Connection-String
                      </Label>
                      <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Sicher lokal gespeichert
                      </span>
                    </div>
                    <Input
                      id="connectionString"
                      value={form.connectionString}
                      onChange={(event) =>
                        update("connectionString", event.target.value)
                      }
                      placeholder="postgresql://user:password@localhost:5432/postgres"
                      className="h-10 font-mono text-xs border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="fields" className="mt-4 space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="col-span-2 grid gap-2">
                      <Label
                        htmlFor="host"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Host
                      </Label>
                      <Input
                        id="host"
                        value={form.host}
                        onChange={(event) =>
                          update("host", event.target.value)
                        }
                        className="h-10 border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label
                        htmlFor="port"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Port
                      </Label>
                      <Input
                        id="port"
                        type="number"
                        value={form.port}
                        onChange={(event) =>
                          update("port", Number(event.target.value) || 0)
                        }
                        className="h-10 border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label
                      htmlFor="database"
                      className="text-xs font-medium text-muted-foreground"
                    >
                      Datenbank-Name
                    </Label>
                    <Input
                      id="database"
                      value={form.database}
                      onChange={(event) =>
                        update("database", event.target.value)
                      }
                      className="h-10 border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label
                        htmlFor="user"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Benutzer
                      </Label>
                      <Input
                        id="user"
                        value={form.user}
                        onChange={(event) =>
                          update("user", event.target.value)
                        }
                        className="h-10 border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label
                        htmlFor="password"
                        className="text-xs font-medium text-muted-foreground"
                      >
                        Passwort
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={form.password}
                        onChange={(event) =>
                          update("password", event.target.value)
                        }
                        className="h-10 border-border/40 bg-background/20 focus-visible:ring-primary/20 rounded-xl"
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              {state.status === "success" && (
                <Alert className="border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 rounded-xl">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <AlertTitle className="text-sm font-semibold">
                    Erfolgreich
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    Die Verbindung zur Datenbank konnte erfolgreich hergestellt werden.
                  </AlertDescription>
                </Alert>
              )}

              {state.status === "error" && (
                <Alert
                  variant="destructive"
                  className="border-destructive/20 bg-destructive/5 rounded-xl"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="text-sm font-semibold">
                    Verbindungsfehler
                  </AlertTitle>
                  <AlertDescription className="text-xs">
                    {state.message}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border/20">
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                  <Button
                    onClick={handleSave}
                    className="flex-1 sm:flex-initial h-10 px-5 rounded-xl shadow-sm hover:shadow transition-all font-medium text-sm"
                  >
                    {editingId ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {editingId ? "Verbindung speichern" : "Verbindung hinzufügen"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleTest}
                    disabled={state.status === "testing"}
                    className="flex-1 sm:flex-initial h-10 px-5 rounded-xl border-border/40 bg-background/20 hover:bg-accent font-medium text-sm"
                  >
                    {state.status === "testing" ? (
                      <Spinner className="h-4 w-4" />
                    ) : null}
                    Verbindung testen
                  </Button>
                </div>
                {editingId && (
                  <Button
                    variant="ghost"
                    onClick={resetForm}
                    className="w-full sm:w-auto h-10 px-4 rounded-xl hover:bg-accent text-sm font-medium"
                  >
                    <X className="h-4 w-4" />
                    Abbrechen
                  </Button>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

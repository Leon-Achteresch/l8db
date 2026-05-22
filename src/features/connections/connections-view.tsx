import { useState } from "react"
import { Link } from "@tanstack/react-router"
import {
  ArrowLeft,
  Check,
  GitBranch,
  Layers,
  Lock,
  Pencil,
  AlertCircle,
  Plus,
  PlugZap,
  Table2,
  Terminal,
  Trash2,
  X,
} from "lucide-react"
import postgresql from "thesvg/postgresql"
import mysql from "thesvg/mysql"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  TAG_COLORS,
  useActiveConnection,
  useConnectionsStore,
  type ConnectionTag,
  type SavedConnection,
} from "@/lib/connections"
import { type DatabaseKind, testConnectionString } from "@/lib/db"

import { OnboardingHero } from "./onboarding-hero"

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success" }
  | { status: "error"; message: string }

type EditorMode = "string" | "fields"

interface FormState {
  name: string
  kind: DatabaseKind
  mode: EditorMode
  connectionString: string
  host: string
  port: number
  user: string
  password: string
  database: string
  tags: ConnectionTag[]
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
}

const FEATURES = [
  {
    Icon: Table2,
    title: "Table Explorer",
    description:
      "Browse, filter, and inline-edit rows across all schemas and tables.",
  },
  {
    Icon: Terminal,
    title: "SQL Console",
    description:
      "Write and execute raw SQL queries with instant, formatted results.",
  },
  {
    Icon: Layers,
    title: "Schema Inspector",
    description:
      "Inspect columns, data types, primary keys, indexes, and constraints.",
  },
  {
    Icon: GitBranch,
    title: "ER Diagrams",
    description:
      "Visualize table relationships and foreign key connections at a glance.",
  },
]

function buildConnectionString(form: FormState): string {
  if (form.mode === "string") return form.connectionString.trim()
  const auth = form.password
    ? `${encodeURIComponent(form.user)}:${encodeURIComponent(form.password)}`
    : encodeURIComponent(form.user)
  return `postgresql://${auth}@${form.host}:${form.port}/${form.database}`
}

function maskConnectionString(str: string): string {
  if (!str) return ""
  try {
    const url = new URL(str)
    if (url.password) url.password = "••••••••"
    return url.toString()
  } catch {
    return str.replace(/:([^:@]+)@/, ":••••••••@")
  }
}

export function ConnectionsView() {
  const connections = useConnectionsStore((state) => state.connections)
  const addConnection = useConnectionsStore((state) => state.addConnection)
  const updateConnection = useConnectionsStore((state) => state.updateConnection)
  const removeConnection = useConnectionsStore((state) => state.removeConnection)
  const setActiveId = useConnectionsStore((state) => state.setActiveId)
  const activeConnection = useActiveConnection()

  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [testState, setTestState] = useState<TestState>({ status: "idle" })
  const [tagInput, setTagInput] = useState("")
  const [tagColor, setTagColor] = useState(TAG_COLORS[0])

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setTestState({ status: "idle" })
  }

  function resetForm() {
    setForm(emptyForm)
    setEditingId(null)
    setTestState({ status: "idle" })
  }

  function startEdit(connection: SavedConnection) {
    setEditingId(connection.id)
    setForm({
      ...emptyForm,
      name: connection.name,
      kind: connection.kind,
      mode: "string",
      connectionString: connection.connectionString,
      tags: connection.tags ?? [],
    })
    setTestState({ status: "idle" })
  }

  async function handleTest() {
    const connectionString = buildConnectionString(form)
    if (!connectionString) {
      setTestState({ status: "error", message: "Connection-String fehlt." })
      return
    }
    setTestState({ status: "testing" })
    try {
      await testConnectionString(form.kind, connectionString)
      setTestState({ status: "success" })
    } catch (error) {
      setTestState({ status: "error", message: String(error) })
    }
  }

  function handleSave() {
    const name = form.name.trim()
    const connectionString = buildConnectionString(form)
    if (!name || !connectionString) {
      setTestState({
        status: "error",
        message: "Name und Connection-String sind erforderlich.",
      })
      return
    }
    const input = { name, kind: form.kind, connectionString, tags: form.tags }
    if (editingId) {
      updateConnection(editingId, input)
    } else {
      addConnection(input)
    }
    resetForm()
  }

  function addTag() {
    const trimmed = tagInput.trim()
    if (trimmed) {
      update("tags", [...form.tags, { name: trimmed, color: tagColor }])
      setTagInput("")
    }
  }

  const formInner = (
    <div className="space-y-6 w-full">
      <div className="grid gap-2">
        <Label htmlFor="conn-name" className="text-sm font-medium">
          Verbindungs-Name
        </Label>
        <Input
          id="conn-name"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          placeholder="z. B. Produktions-Datenbank"
          className="h-10 rounded-xl border-border/40 bg-background/20 focus-visible:border-primary focus-visible:ring-primary/20"
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
                    ? "scale-110 border-foreground"
                    : "border-transparent hover:scale-110"
                }`}
                style={{ backgroundColor: color }}
                onClick={() => setTagColor(color)}
              />
            ))}
          </div>
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addTag()
              }
            }}
            placeholder="Tag-Name + Enter"
            className="h-8 flex-1 rounded-xl border-border/40 bg-background/20 text-xs focus-visible:ring-primary/20"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-xl border-border/40 text-xs"
            onClick={addTag}
          >
            <Plus className="size-3" />
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <Label className="text-sm font-medium">Datenbank-Typ</Label>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => update("kind", "postgres")}
            className={`relative flex items-center gap-4 rounded-xl border p-4 text-left transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 ${
              form.kind === "postgres"
                ? "border-primary bg-primary/[0.02]"
                : "border-border/40 bg-background/20 hover:bg-accent/40"
            }`}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/10 bg-background/50 p-1.5 [&_svg]:h-full [&_svg]:w-full"
              style={{ color: `#${postgresql.hex}` }}
              dangerouslySetInnerHTML={{ __html: postgresql.svg }}
            />
            <div className="min-w-0">
              <div className="text-sm font-semibold">PostgreSQL</div>
              <div className="truncate text-xs text-muted-foreground">
                Standard relationale SQL-Datenbank
              </div>
            </div>
            {form.kind === "postgres" && (
              <span className="absolute right-3 top-3 flex h-2 w-2 rounded-full bg-primary" />
            )}
          </button>

          <div className="relative flex items-center gap-4 rounded-xl border border-dashed border-border/40 bg-muted/10 p-4 text-left opacity-60">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border/10 bg-background/50 p-1.5 opacity-70 grayscale [&_svg]:h-full [&_svg]:w-full"
              style={{ color: `#${mysql.hex}` }}
              dangerouslySetInnerHTML={{ __html: mysql.svg }}
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-sm font-semibold">
                MySQL
                <Badge
                  variant="outline"
                  className="rounded-full bg-background/50 px-1.5 py-0 text-[9px] font-normal leading-normal"
                >
                  Soon
                </Badge>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                Demnächst unterstützt
              </div>
            </div>
          </div>
        </div>
      </div>

      <Tabs
        value={form.mode}
        onValueChange={(v) => update("mode", v as EditorMode)}
        className="w-full"
      >
        <TabsList className="grid h-10 w-full grid-cols-2 rounded-xl border border-border/20 bg-muted/30 p-1">
          <TabsTrigger value="string" className="rounded-lg py-1.5 text-xs font-medium">
            Connection-String
          </TabsTrigger>
          <TabsTrigger value="fields" className="rounded-lg py-1.5 text-xs font-medium">
            Einzelne Felder
          </TabsTrigger>
        </TabsList>

        <TabsContent value="string" className="mt-4 space-y-3">
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="conn-string"
                className="text-xs font-medium text-muted-foreground"
              >
                Connection-String
              </Label>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                <Lock className="h-3 w-3" />
                Sicher lokal gespeichert
              </span>
            </div>
            <Input
              id="conn-string"
              value={form.connectionString}
              onChange={(e) => update("connectionString", e.target.value)}
              placeholder="postgresql://user:password@localhost:5432/postgres"
              className="h-10 rounded-xl border-border/40 bg-background/20 font-mono text-xs focus-visible:ring-primary/20"
            />
          </div>
        </TabsContent>

        <TabsContent value="fields" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2 grid gap-2">
              <Label
                htmlFor="conn-host"
                className="text-xs font-medium text-muted-foreground"
              >
                Host
              </Label>
              <Input
                id="conn-host"
                value={form.host}
                onChange={(e) => update("host", e.target.value)}
                className="h-10 rounded-xl border-border/40 bg-background/20 focus-visible:ring-primary/20"
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor="conn-port"
                className="text-xs font-medium text-muted-foreground"
              >
                Port
              </Label>
              <Input
                id="conn-port"
                type="number"
                value={form.port}
                onChange={(e) => update("port", Number(e.target.value) || 0)}
                className="h-10 rounded-xl border-border/40 bg-background/20 focus-visible:ring-primary/20"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label
              htmlFor="conn-db"
              className="text-xs font-medium text-muted-foreground"
            >
              Datenbank-Name
            </Label>
            <Input
              id="conn-db"
              value={form.database}
              onChange={(e) => update("database", e.target.value)}
              className="h-10 rounded-xl border-border/40 bg-background/20 focus-visible:ring-primary/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label
                htmlFor="conn-user"
                className="text-xs font-medium text-muted-foreground"
              >
                Benutzer
              </Label>
              <Input
                id="conn-user"
                value={form.user}
                onChange={(e) => update("user", e.target.value)}
                className="h-10 rounded-xl border-border/40 bg-background/20 focus-visible:ring-primary/20"
              />
            </div>
            <div className="grid gap-2">
              <Label
                htmlFor="conn-pw"
                className="text-xs font-medium text-muted-foreground"
              >
                Passwort
              </Label>
              <Input
                id="conn-pw"
                type="password"
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                className="h-10 rounded-xl border-border/40 bg-background/20 focus-visible:ring-primary/20"
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {testState.status === "success" && (
        <Alert className="rounded-xl border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400">
          <Check className="h-4 w-4 text-emerald-500" />
          <AlertTitle className="text-sm font-semibold">Erfolgreich</AlertTitle>
          <AlertDescription className="text-xs">
            Die Verbindung zur Datenbank konnte erfolgreich hergestellt werden.
          </AlertDescription>
        </Alert>
      )}

      {testState.status === "error" && (
        <Alert
          variant="destructive"
          className="rounded-xl border-destructive/20 bg-destructive/5"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertTitle className="text-sm font-semibold">Verbindungsfehler</AlertTitle>
          <AlertDescription className="text-xs">{testState.message}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3 border-t border-border/20 pt-4 sm:flex-row">
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            onClick={handleSave}
            className="h-10 flex-1 rounded-xl px-5 text-sm font-medium sm:flex-initial"
          >
            {editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {editingId ? "Verbindung speichern" : "Verbindung hinzufügen"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testState.status === "testing"}
            className="h-10 flex-1 rounded-xl border-border/40 bg-background/20 px-5 text-sm font-medium hover:bg-accent sm:flex-initial"
          >
            {testState.status === "testing" ? <Spinner className="h-4 w-4" /> : null}
            Verbindung testen
          </Button>
        </div>
        {editingId && (
          <Button
            variant="ghost"
            onClick={resetForm}
            className="h-10 w-full rounded-xl px-4 text-sm font-medium hover:bg-accent sm:w-auto"
          >
            <X className="h-4 w-4" />
            Abbrechen
          </Button>
        )}
      </div>
    </div>
  )

  if (connections.length === 0) {
    return (
      <div className="h-full w-full overflow-x-hidden overflow-y-auto">
        <OnboardingHero />

        <section className="w-full px-6 py-24">
          <div className="mx-auto max-w-4xl">
            <div className="mb-14 text-center">
              <h2 className="text-3xl font-bold tracking-tight">
                Alles, was du brauchst
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Ein vollständiges Toolkit für deine PostgreSQL-Datenbanken
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <div
                  key={feature.title}
                  className="space-y-3 rounded-2xl border border-border/40 bg-background/60 p-6"
                >
                  <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    <feature.Icon className="size-5 text-primary" />
                  </div>
                  <h3 className="text-sm font-semibold">{feature.title}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-6 pb-32 pt-4">
          <div className="mx-auto max-w-lg">
            <div className="mb-8 text-center">
              <h2 className="text-2xl font-bold tracking-tight">
                Erste Verbindung einrichten
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Verbinde l8db mit deiner PostgreSQL-Datenbank
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-8">
              {formInner}
            </div>
          </div>
        </section>
      </div>
    )
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
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                Datenbank-Verbindungen
              </h1>
            </div>
            <p className="pl-12 text-sm text-muted-foreground">
              Verwalte deine aktiven Verbindungen und füge neue SQL-Datenbanken
              hinzu.
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
              {connections.map((connection) => {
                const isActive = connection.id === activeConnection?.id
                const isEditing = connection.id === editingId
                const isPostgres = connection.kind === "postgres"
                const rowHighlight = isActive
                  ? "border-l-2 border-emerald-500 bg-emerald-500/[0.03] pl-3"
                  : isEditing
                    ? "border-l-2 border-primary bg-primary/[0.02] pl-3"
                    : "border-l-2 border-transparent pl-3 hover:bg-muted/40"
                return (
                  <div
                    key={connection.id}
                    className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-center gap-x-3 gap-y-1 py-3 pr-1 transition-colors ${rowHighlight}`}
                  >
                    <div
                      className="row-span-2 size-10 shrink-0 overflow-hidden rounded-lg border border-border/20 bg-background/50 p-1.5 [&_svg]:block [&_svg]:size-full"
                      style={{
                        color: isPostgres ? `#${postgresql.hex}` : `#${mysql.hex}`,
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
                      {isActive && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <span className="relative flex size-1.5 rounded-full bg-emerald-500">
                            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          </span>
                          Aktiv
                        </span>
                      )}
                    </div>
                    <div className="col-start-3 row-span-2 flex shrink-0 items-center gap-0.5 self-center">
                      {!isActive && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 rounded-lg hover:bg-emerald-500/10 hover:text-emerald-600"
                          onClick={() => setActiveId(connection.id)}
                          title="Aktivieren"
                        >
                          <Check className="size-4" />
                        </Button>
                      )}
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
                          removeConnection(connection.id)
                          if (editingId === connection.id) resetForm()
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
                )
              })}
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-6 overflow-hidden">
            <div className="space-y-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
                <PlugZap className="h-5 w-5 text-primary" />
                {editingId ? "Verbindung bearbeiten" : "Neue Verbindung einrichten"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Gib die Verbindungsdaten manuell ein oder verwende einen
                Connection-String.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-8">
              {formInner}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

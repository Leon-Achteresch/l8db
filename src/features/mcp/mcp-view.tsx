import { Bot, Check, Copy, Plus, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SettingsRow } from "@/features/settings/settings-row";
import {
  clearMcpAudit,
  defaultRedaction,
  listMcpClients,
  type McpAuditEntry,
  type McpClient,
  type McpConfig,
  type McpConnection,
  mcpAuditTail,
  mcpServerCommand,
  type RedactRule,
  redactPreview,
  registerMcpClient,
  saveMcpConfig,
  syncMcpConfig,
} from "@/lib/mcp";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border border-border/80 bg-card p-4 shadow-sm";

function unsupportedReason(connection: McpConnection): string | null {
  if (connection.ssh) return "SSH-Tunnel werden nicht unterstützt";
  if (["mongodb", "redis"].includes(connection.kind)) return "Nur SQL-Datenbanken";
  return null;
}

export function McpView() {
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [clients, setClients] = useState<McpClient[]>([]);
  const [command, setCommand] = useState("");
  const [audit, setAudit] = useState<McpAuditEntry[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshAudit = useCallback(() => {
    void mcpAuditTail(50)
      .then(setAudit)
      .catch(() => setAudit([]));
  }, []);

  useEffect(() => {
    void syncMcpConfig()
      .then(setConfig)
      .catch((error) => toast.error(String(error)));
    void listMcpClients()
      .then(setClients)
      .catch(() => setClients([]));
    void mcpServerCommand()
      .then(setCommand)
      .catch(() => setCommand(""));
    refreshAudit();
  }, [refreshAudit]);

  const update = (patch: (current: McpConfig) => McpConfig) => {
    setConfig((current) => {
      if (!current) return current;
      const next = patch(current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveMcpConfig(next)
          .then(() => setSaveError(null))
          .catch((error) => setSaveError(String(error)));
      }, 300);
      return next;
    });
  };

  const updateConnection = (id: string, patch: Partial<McpConnection>) =>
    update((current) => ({
      ...current,
      connections: current.connections.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    }));

  const toggleClient = async (client: McpClient) => {
    try {
      setClients(await registerMcpClient(client.id, !client.registered));
      toast.success(
        client.registered
          ? `Aus ${client.name} entfernt.`
          : `In ${client.name} eingetragen. CLI neu starten, damit es greift.`,
      );
    } catch (error) {
      toast.error(String(error));
    }
  };

  if (!config) {
    return (
      <main className="h-full min-h-0 w-full overflow-y-auto p-8">
        <p className="text-sm text-muted-foreground">MCP-Konfiguration wird geladen…</p>
      </main>
    );
  }

  const exposedCount = config.connections.filter((entry) => entry.exposed).length;

  return (
    <main className="@container h-full min-h-0 w-full overflow-y-auto p-8">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <h1 className="text-2xl font-semibold">MCP</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Stellt freigegebene Datenbanken für KI-CLIs bereit. Läuft nur, wenn eine CLI ihn
              startet, l8db muss dafür nicht offen sein.
            </p>
          </div>
        </div>

        {saveError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {saveError}
          </p>
        ) : null}

        <SettingsRow
          title="MCP-Server aktiv"
          description={
            config.enabled
              ? `Aktiv, ${exposedCount} ${exposedCount === 1 ? "Verbindung" : "Verbindungen"} freigegeben.`
              : "Deaktiviert. Registrierte CLIs bekommen bei jedem Aufruf eine Absage."
          }
        >
          <Switch
            checked={config.enabled}
            onCheckedChange={(enabled) => update((current) => ({ ...current, enabled }))}
            aria-label="MCP-Server aktiv"
          />
        </SettingsRow>

        <section className="space-y-3">
          <SectionTitle
            title="CLIs"
            description="Trägt den Server global in die Konfiguration der jeweiligen CLI ein. Vor dem Schreiben wird eine .bak-Kopie angelegt."
          />
          <div className="grid gap-3 @min-[38rem]:grid-cols-2">
            {clients.map((client) => (
              <div key={client.id} className={cn(CARD, "flex items-center justify-between gap-3")}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold">{client.name}</p>
                    {client.registered ? (
                      <Badge variant="secondary">eingetragen</Badge>
                    ) : client.installed ? null : (
                      <Badge variant="outline">nicht gefunden</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {client.configPath}
                  </p>
                </div>
                <Button
                  variant={client.registered ? "outline" : "default"}
                  size="sm"
                  onClick={() => void toggleClient(client)}
                >
                  {client.registered ? "Entfernen" : "Hinzufügen"}
                </Button>
              </div>
            ))}
          </div>
          {command ? (
            <div className={cn(CARD, "flex items-center justify-between gap-3")}>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Manuell eintragen</p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                  {command}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(command);
                  toast.success("Befehl kopiert.");
                }}
              >
                <Copy className="size-3.5" />
                Kopieren
              </Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <SectionTitle
            title="Verbindungen"
            description="Nur freigegebene Verbindungen sind sichtbar. Passwörter kommen aus dem Schlüsselbund, nicht aus dieser Datei."
          />
          {config.connections.length === 0 ? (
            <p className={cn(CARD, "text-sm text-muted-foreground")}>
              Noch keine Verbindungen gespeichert.
            </p>
          ) : (
            config.connections.map((connection) => {
              const reason = unsupportedReason(connection);
              return (
                <div key={connection.id} className={cn(CARD, "space-y-3")}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{connection.name}</p>
                        <Badge variant="outline">{connection.kind}</Badge>
                        {reason ? <Badge variant="secondary">{reason}</Badge> : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {connection.connectionString}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      Freigeben
                      <Switch
                        checked={connection.exposed}
                        disabled={reason !== null}
                        onCheckedChange={(exposed) => updateConnection(connection.id, { exposed })}
                        aria-label={`${connection.name} freigeben`}
                      />
                    </div>
                  </div>
                  {connection.exposed ? (
                    <div className="grid gap-3 border-t border-border/60 pt-3 @min-[38rem]:grid-cols-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        Nur lesen
                        <Switch
                          checked={connection.readOnly}
                          onCheckedChange={(readOnly) =>
                            updateConnection(connection.id, {
                              readOnly,
                              allowDdl: readOnly ? false : connection.allowDdl,
                            })
                          }
                          aria-label={`${connection.name} nur lesen`}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        DDL erlauben
                        <Switch
                          checked={connection.allowDdl}
                          disabled={connection.readOnly}
                          onCheckedChange={(allowDdl) =>
                            updateConnection(connection.id, { allowDdl })
                          }
                          aria-label={`${connection.name} DDL erlauben`}
                        />
                      </div>
                      <label
                        className="flex flex-col gap-1 text-xs"
                        htmlFor={`mcp-redact-${connection.id}`}
                      >
                        Zusätzliche Spaltenmuster (Komma)
                        <Input
                          id={`mcp-redact-${connection.id}`}
                          className="h-7 font-mono text-[11px]"
                          defaultValue={connection.redactColumns.join(", ")}
                          placeholder="kunden_.*, geheim"
                          onBlur={(event) =>
                            updateConnection(connection.id, {
                              redactColumns: event.target.value
                                .split(",")
                                .map((entry) => entry.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </label>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </section>

        <section className="space-y-3">
          <SectionTitle
            title="Redaktion"
            description="Spaltenregeln maskieren ganze Spalten anhand des Namens. Wertregeln maskieren Treffer innerhalb von Zellinhalten. Reguläre Ausdrücke, Spaltenregeln ohne Groß-/Kleinschreibung."
          />
          <div className={cn(CARD, "flex items-center justify-between gap-3")}>
            <label className="text-sm font-semibold" htmlFor="mcp-replacement">
              Ersatztext
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="mcp-replacement"
                className="h-7 w-40 font-mono text-[11px]"
                value={config.redaction.replacement}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    redaction: { ...current.redaction, replacement: event.target.value },
                  }))
                }
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void defaultRedaction().then((redaction) =>
                    update((current) => ({ ...current, redaction })),
                  )
                }
              >
                <RotateCcw className="size-3.5" />
                Standard
              </Button>
            </div>
          </div>
          <RuleList
            title="Spaltenregeln"
            rules={config.redaction.columns}
            onChange={(columns) =>
              update((current) => ({
                ...current,
                redaction: { ...current.redaction, columns },
              }))
            }
          />
          <RuleList
            title="Wertregeln"
            rules={config.redaction.values}
            onChange={(values) =>
              update((current) => ({
                ...current,
                redaction: { ...current.redaction, values },
              }))
            }
          />
          <RedactionTester config={config} />
        </section>

        <section className="space-y-3">
          <SectionTitle
            title="Limits"
            description="Kleine Antworten sparen Tokens. Zellen werden gekürzt, Ergebnisse gedeckelt."
          />
          <div className={cn(CARD, "grid gap-3 @min-[38rem]:grid-cols-4")}>
            <NumberField
              label="Zeilen pro Abfrage"
              value={config.maxRows}
              min={1}
              max={1000}
              onChange={(maxRows) => update((current) => ({ ...current, maxRows }))}
            />
            <NumberField
              label="Zeichen pro Zelle"
              value={config.maxCellChars}
              min={10}
              max={10000}
              onChange={(maxCellChars) => update((current) => ({ ...current, maxCellChars }))}
            />
            <NumberField
              label="Zeichen pro Antwort"
              value={config.maxChars}
              min={500}
              max={200000}
              onChange={(maxChars) => update((current) => ({ ...current, maxChars }))}
            />
            <NumberField
              label="Timeout (s)"
              value={config.queryTimeout}
              min={5}
              max={300}
              onChange={(queryTimeout) => update((current) => ({ ...current, queryTimeout }))}
            />
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <SectionTitle
              title="Protokoll"
              description="Die letzten Abfragen über den MCP. SQL wird gekürzt gespeichert."
            />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refreshAudit}>
                <RefreshCw className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void clearMcpAudit().then(refreshAudit)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className={cn(CARD, "overflow-x-auto p-0")}>
            {audit.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Noch keine Aufrufe.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody>
                  {audit.map((entry, index) => (
                    <tr
                      key={`${entry.ts}-${index}`}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                        {entry.ts.replace("T", " ").replace("Z", "")}
                      </td>
                      <td className="px-3 py-1.5 font-medium">{entry.connection}</td>
                      <td className="px-3 py-1.5">{entry.tool}</td>
                      <td className="max-w-md truncate px-3 py-1.5 font-mono">{entry.sql}</td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {entry.ms} ms
                      </td>
                      <td className="px-3 py-1.5">
                        {entry.ok ? (
                          <Check className="size-3.5 text-primary" />
                        ) : (
                          <span className="text-destructive" title={entry.error ?? ""}>
                            Fehler
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = `mcp-limit-${label.replace(/\W+/g, "-")}`;
  return (
    <label className="flex flex-col gap-1 text-xs" htmlFor={id}>
      {label}
      <Input
        id={id}
        type="number"
        className="h-7"
        min={min}
        max={max}
        defaultValue={value}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
        }}
      />
    </label>
  );
}

function RuleList({
  title,
  rules,
  onChange,
}: {
  title: string;
  rules: RedactRule[];
  onChange: (rules: RedactRule[]) => void;
}) {
  const setRule = (index: number, patch: Partial<RedactRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const active = rules.filter((rule) => rule.enabled).length;
  return (
    <div className={cn(CARD, "space-y-2")}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {title}{" "}
          <span className="font-normal text-muted-foreground">
            {active}/{rules.length} aktiv
          </span>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange([...rules, { name: "Neue Regel", pattern: "", enabled: true }])}
        >
          <Plus className="size-3.5" />
          Regel
        </Button>
      </div>
      <div className="space-y-1.5">
        {rules.map((rule, index) => (
          <div key={`${title}-${index}`} className="flex items-center gap-2">
            <Checkbox
              checked={rule.enabled}
              onCheckedChange={(checked) => setRule(index, { enabled: checked === true })}
              aria-label={`${rule.name} aktiv`}
            />
            <Input
              className="h-7 w-40 shrink-0 text-xs"
              value={rule.name}
              onChange={(event) => setRule(index, { name: event.target.value })}
              aria-label="Regelname"
            />
            <Input
              className="h-7 flex-1 font-mono text-[11px]"
              value={rule.pattern}
              onChange={(event) => setRule(index, { pattern: event.target.value })}
              aria-label="Muster"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
              aria-label={`${rule.name} löschen`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RedactionTester({ config }: { config: McpConfig }) {
  const [column, setColumn] = useState("notiz");
  const [text, setText] = useState(
    "Kontakt max@example.com, IBAN DE89 3704 0044 0532 0130 00, Tel +49 170 1234567",
  );
  const [result, setResult] = useState("");
  useEffect(() => {
    const handle = setTimeout(() => {
      redactPreview(config, column, text)
        .then(setResult)
        .catch((error) => setResult(String(error)));
    }, 200);
    return () => clearTimeout(handle);
  }, [config, column, text]);
  return (
    <div className={cn(CARD, "space-y-2")}>
      <p className="text-sm font-semibold">Regeln testen</p>
      <div className="flex gap-2">
        <Input
          className="h-7 w-40 font-mono text-[11px]"
          value={column}
          onChange={(event) => setColumn(event.target.value)}
          aria-label="Spaltenname"
        />
        <Textarea
          className="min-h-14 flex-1 font-mono text-[11px]"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label="Testtext"
        />
      </div>
      <p className="rounded-lg bg-muted px-3 py-2 font-mono text-[11px] break-all">
        {result || "…"}
      </p>
    </div>
  );
}

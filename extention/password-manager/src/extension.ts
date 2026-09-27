import type {
  ExtensionContext,
  Json,
  L8dbApi,
  ProcessSession,
  VaultConnection,
} from "@l8db/extension-api";

export const MARKER = "l8db-connection:v1:";
const TITLE_PREFIX = "l8db: ";
const PREFIX = /^\s*l8db\s*:\s*/i;
const NOTES_HINT =
  "Von l8db angelegt. Adresse, Benutzername und Passwort darfst du hier ändern, die letzte Zeile bitte nicht.";
const TIMEOUT = 120000;

export interface VaultRecord {
  ref: string;
  connection: VaultConnection;
}

export interface VaultEntry {
  ref: string;
  title: unknown;
  notes?: unknown;
  username?: unknown;
  password?: unknown;
  urls?: unknown[];
}

export interface SyncResult {
  total: number;
  added: number;
  updated: number;
  removed: number;
  hidden: number;
  skipped: string[];
}

export type VaultState = "signed-out" | "locked" | "signed-in";

export interface VaultStatus {
  provider: string;
  cli: string | null;
  state: VaultState;
  account?: string;
  server?: string;
  accounts?: { id: string; label: string }[];
  needs?: "code" | "terminal" | "device" | "2fa";
  channels?: { id: string; label: string }[];
  detail?: string;
}

type VaultPrompt = Pick<VaultStatus, "needs" | "channels" | "detail">;

export interface VaultLogin {
  email?: string;
  password?: string;
  code?: string;
  method?: string;
  server?: string;
  clientId?: string;
  clientSecret?: string;
  account?: string;
  channel?: string;
}

export interface VaultSession {
  bw: string | null;
  op: string | null;
  keeper?: { session: ProcessSession; needs: VaultStatus["needs"] } | null;
}

export interface VaultBackend {
  list(): Promise<VaultRecord[]>;
  create(connection: VaultConnection): Promise<void>;
  update(ref: string, connection: VaultConnection): Promise<void>;
}

const SCHEMES: Record<string, string> = {
  postgres: "postgres",
  postgresql: "postgres",
  mysql: "mysql",
  mariadb: "mysql",
  mssql: "mssql",
  sqlserver: "mssql",
  clickhouse: "clickhouse",
  mongodb: "mongodb",
  "mongodb+srv": "mongodb",
  redis: "redis",
  rediss: "redis",
  valkey: "redis",
  oracle: "oracle",
  cassandra: "cassandra",
  scylla: "cassandra",
  elasticsearch: "elasticsearch",
  opensearch: "elasticsearch",
  influxdb: "influxdb",
  libsql: "sqlite_http",
  snowflake: "snowflake",
};

function encode(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(text: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)));
}

export function toNotes(connection: VaultConnection): string {
  const { password: _password, ...rest } = connection;
  return `${NOTES_HINT}\n${MARKER}${encode(JSON.stringify(rest))}`;
}

export function address(value: unknown, user?: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const kind = SCHEMES[/^([a-z][a-z0-9+.-]*):\/\//i.exec(text)?.[1].toLowerCase() ?? ""];
  if (!kind) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (!url.hostname) return null;
  const secret = url.password ? decodeURIComponent(url.password) : null;
  url.password = "";
  if (typeof user === "string" && user.trim()) url.username = encodeURIComponent(user.trim());
  return { kind, connectionString: url.toString(), secret };
}

export function isEntryTitle(value: unknown) {
  return typeof value === "string" && PREFIX.test(value);
}

export function readEntry(provider: string, entry: VaultEntry): VaultConnection | null {
  const stored = fromNotes(entry.notes, entry.password);
  const target = (entry.urls ?? [])
    .map((url) => address(url, entry.username))
    .find((found) => found !== null);
  if (!stored && !target) return null;
  const id = stored?.id ?? `pm-${provider}-${entry.ref}`;
  const title = typeof entry.title === "string" ? entry.title.replace(PREFIX, "").trim() : "";
  const name = title || stored?.name || id;
  const kind = stored?.kind ?? (target?.kind as string);
  const connectionString = target?.connectionString ?? (stored?.connectionString as string);
  const password =
    typeof entry.password === "string" && entry.password
      ? entry.password
      : (target?.secret ?? null);
  const base =
    stored?.profile && typeof stored.profile === "object" && !Array.isArray(stored.profile)
      ? stored.profile
      : {};
  return {
    id,
    name,
    kind,
    connectionString,
    password,
    profile: { ...base, id, name, kind, connectionString },
  };
}

function link(connection: VaultConnection) {
  return address(connection.connectionString) ? connection.connectionString : null;
}

export function fromNotes(notes: unknown, password: unknown): VaultConnection | null {
  if (typeof notes !== "string") return null;
  const line = notes.split("\n").find((entry) => entry.trim().startsWith(MARKER));
  if (!line) return null;
  try {
    const data = JSON.parse(decode(line.trim().slice(MARKER.length)));
    if (typeof data?.id !== "string" || typeof data?.connectionString !== "string") return null;
    return { ...data, password: typeof password === "string" && password ? password : null };
  } catch {
    return null;
  }
}

export function title(connection: VaultConnection): string {
  return TITLE_PREFIX + connection.name;
}

export function username(connectionString: string): string {
  try {
    return decodeURIComponent(new URL(connectionString).username);
  } catch {
    return "";
  }
}

async function run(api: L8dbApi, command: string, args: string[], env?: Record<string, string>) {
  let result: Awaited<ReturnType<L8dbApi["process"]["run"]>>;
  try {
    result = await api.process.run(command, { args, env, timeoutMs: TIMEOUT });
  } catch (error) {
    throw new Error(
      `${command} konnte nicht gestartet werden. Ist die CLI installiert? (${String(error)})`,
    );
  }
  if (result.status !== 0)
    throw new Error(
      `${command} ${args[0] ?? ""} fehlgeschlagen: ${(result.stderr || result.stdout).trim().slice(0, 500)}`,
    );
  return result.stdout;
}

function json(text: string): unknown {
  const start = text.search(/[[{]/);
  return JSON.parse(start < 0 ? text : text.slice(start));
}

export function keeper(api: L8dbApi): VaultBackend {
  const call = (...args: string[]) => run(api, "keeper", ["--batch-mode", ...args]);
  const secret = (name: string, value: string) => `${name}=$BASE64:${encode(value)}`;
  const fields = (connection: VaultConnection) => {
    const url = link(connection);
    return [
      ...(username(connection.connectionString)
        ? [secret("login", username(connection.connectionString))]
        : []),
      ...(connection.password ? [secret("password", connection.password)] : []),
      ...(url ? [secret("url", url)] : []),
    ];
  };
  return {
    async list() {
      const found = json((await call("search", "l8db", "-c", "r", "--format", "json")) || "[]");
      const records: VaultRecord[] = [];
      for (const hit of Array.isArray(found) ? found : []) {
        if (typeof hit?.record_uid !== "string" || !isEntryTitle(hit.title)) continue;
        const record = json(
          await call("get", hit.record_uid, "--format", "json", "--unmask"),
        ) as Record<string, unknown>;
        const list = Array.isArray(record.fields)
          ? (record.fields as { type?: string; value?: unknown[] }[])
          : [];
        const value = (type: string) => list.find((field) => field.type === type)?.value ?? [];
        const connection = readEntry("keeper", {
          ref: hit.record_uid,
          title: record.title ?? hit.title,
          notes: record.notes,
          username: value("login")[0] ?? record.login,
          password: value("password")[0] ?? record.password,
          urls: [...value("url"), record.login_url],
        });
        if (connection) records.push({ ref: hit.record_uid, connection });
      }
      return records;
    },
    async create(connection) {
      await call(
        "record-add",
        "-f",
        "-t",
        title(connection),
        "-rt",
        "login",
        "-n",
        toNotes(connection),
        ...fields(connection),
      );
    },
    async update(ref, connection) {
      await call(
        "record-update",
        "-f",
        "-r",
        ref,
        "-t",
        title(connection),
        "-n",
        toNotes(connection),
        ...fields(connection),
      );
    },
  };
}

export function bitwarden(api: L8dbApi, auth: VaultSession = { bw: null, op: null }): VaultBackend {
  const unlock = async () => {
    if (auth.bw) return auth.bw;
    const status = json(await run(api, "bw", ["status"])) as { status?: string };
    if (status.status === "unauthenticated")
      throw new Error(
        "Bitwarden ist auf diesem Gerät nicht angemeldet. Öffne Einstellungen → Erweiterungen → Passwortmanager-Sync und melde dich an.",
      );
    const password = await api.window.showInputBox({
      title: "Bitwarden entsperren",
      prompt: "Master-Passwort, um die Datenbank-Zugänge zu laden",
      password: true,
    });
    if (!password) throw new Error("Abgebrochen.");
    auth.bw = (
      await run(api, "bw", ["unlock", "--raw", "--passwordenv", "L8DB_BW_PASSWORD"], {
        L8DB_BW_PASSWORD: password,
      })
    ).trim();
    await run(api, "bw", ["sync", "--session", auth.bw]);
    return auth.bw;
  };
  const call = async (...args: string[]) => run(api, "bw", [...args, "--session", await unlock()]);
  const items = new Map<string, Record<string, unknown>>();
  const body = (connection: VaultConnection, base: Record<string, unknown> = {}) => {
    const login = (base.login as Record<string, unknown>) ?? {};
    const url = link(connection);
    return encode(
      JSON.stringify({
        type: 1,
        ...base,
        name: title(connection),
        notes: toNotes(connection),
        login: {
          ...login,
          username: username(connection.connectionString) || null,
          password: connection.password,
          uris: url ? [{ match: null, uri: url }] : (login.uris ?? []),
        },
      }),
    );
  };
  return {
    async list() {
      const found = json(await call("list", "items", "--search", "l8db"));
      const records: VaultRecord[] = [];
      for (const item of Array.isArray(found) ? found : []) {
        if (typeof item?.id !== "string" || !isEntryTitle(item.name)) continue;
        const uris = Array.isArray(item.login?.uris) ? item.login.uris : [];
        const connection = readEntry("bitwarden", {
          ref: item.id,
          title: item.name,
          notes: item.notes,
          username: item.login?.username,
          password: item.login?.password,
          urls: uris.map((entry: { uri?: unknown }) => entry?.uri),
        });
        if (!connection) continue;
        items.set(item.id, item);
        records.push({ ref: item.id, connection });
      }
      return records;
    },
    async create(connection) {
      await call("create", "item", body(connection));
    },
    async update(ref, connection) {
      await call("edit", "item", ref, body(connection, items.get(ref)));
    },
  };
}

export function onePassword(
  api: L8dbApi,
  auth: VaultSession = { bw: null, op: null },
): VaultBackend {
  const call = (...args: string[]) =>
    run(api, "op", [...args, ...(auth.op ? ["--account", auth.op] : [])]);
  const assignments = (connection: VaultConnection) => {
    const url = link(connection);
    return [
      ...(url ? ["--url", url] : []),
      `username=${username(connection.connectionString)}`,
      `password=${connection.password ?? ""}`,
      `notesPlain=${toNotes(connection)}`,
    ];
  };
  return {
    async list() {
      const found = json((await call("item", "list", "--format", "json")) || "[]");
      const records: VaultRecord[] = [];
      for (const hit of Array.isArray(found) ? found : []) {
        if (typeof hit?.id !== "string") continue;
        const tagged = Array.isArray(hit.tags) && hit.tags.includes("l8db");
        if (!tagged && !isEntryTitle(hit.title)) continue;
        const item = json(await call("item", "get", hit.id, "--format", "json", "--reveal")) as {
          title?: string;
          fields?: { id?: string; purpose?: string; value?: unknown }[];
          urls?: { href?: unknown }[];
        };
        const field = (id: string, purpose: string) =>
          item.fields?.find((f) => f.id === id || f.purpose === purpose)?.value;
        const connection = readEntry("1password", {
          ref: hit.id,
          title: item.title ?? hit.title,
          notes: field("notesPlain", "NOTES"),
          username: field("username", "USERNAME"),
          password: field("password", "PASSWORD"),
          urls: (item.urls ?? hit.urls ?? []).map((entry: { href?: unknown }) => entry?.href),
        });
        if (connection) records.push({ ref: hit.id, connection });
      }
      return records;
    },
    async create(connection) {
      await call(
        "item",
        "create",
        "--category",
        "Login",
        "--title",
        title(connection),
        "--tags",
        "l8db",
        ...assignments(connection),
      );
    },
    async update(ref, connection) {
      await call("item", "edit", ref, "--title", title(connection), ...assignments(connection));
    },
  };
}

export const backends: Record<string, (api: L8dbApi, auth?: VaultSession) => VaultBackend> = {
  keeper,
  bitwarden,
  "1password": onePassword,
};

const labels: Record<string, string> = {
  keeper: "Keeper",
  bitwarden: "Bitwarden",
  "1password": "1Password",
};

async function pick(api: L8dbApi, connections: VaultConnection[], placeholder: string) {
  const items = connections.map((connection) => ({
    label: connection.name,
    description: connection.kind,
    detail: connection.id,
    picked: true,
  }));
  const chosen = await api.window.showQuickPick(items, { title: placeholder, canPickMany: true });
  if (!chosen?.length) return [];
  const ids = new Set(chosen.map((entry) => (typeof entry === "string" ? entry : entry.detail)));
  return connections.filter((connection) => ids.has(connection.id));
}

function unique(records: VaultRecord[]) {
  return [...new Map(records.map((record) => [record.connection.id, record.connection])).values()];
}

function slug(provider: string) {
  return provider.replace(/[^a-zA-Z0-9_-]/g, "");
}

async function tracked(api: L8dbApi, key: string): Promise<string[] | null> {
  try {
    const value = await api.storage.get(key);
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return null;
  }
}

async function remember(api: L8dbApi, provider: string, ids: string[]) {
  const key = `known_${slug(provider)}`;
  const known = await tracked(api, key);
  if (known) await api.storage.set(key, [...new Set([...known, ...ids])]).catch(() => undefined);
}

export async function importConnections(api: L8dbApi, backend: VaultBackend, name: string) {
  const local = new Set((await api.connections.list()).map((connection) => connection.id));
  const hidden = unique(await backend.list()).filter((connection) => !local.has(connection.id));
  if (!hidden.length) {
    await api.window.showInformationMessage(`Keine ausgeblendeten Verbindungen in ${name}.`);
    return { added: 0, updated: 0, skipped: [] };
  }
  const selected = await pick(api, hidden, "Wieder einblenden");
  if (!selected.length) return { added: 0, updated: 0, skipped: [] };
  const result = await api.connections.save(selected);
  await api.window.showInformationMessage(
    `${name}: ${result.added} wieder eingeblendet${result.skipped.length ? `, übersprungen: ${result.skipped.join(", ")}` : ""}.`,
  );
  return result;
}

async function store(backend: VaultBackend, connections: VaultConnection[]) {
  const existing = new Map(
    (await backend.list()).map((record) => [record.connection.id, record.ref]),
  );
  let created = 0;
  for (const connection of connections) {
    const ref = existing.get(connection.id);
    if (ref) await backend.update(ref, connection);
    else {
      await backend.create(connection);
      created++;
    }
  }
  return { created, updated: connections.length - created };
}

export async function saveConnection(
  api: L8dbApi,
  backend: VaultBackend,
  provider: string,
  id: string,
) {
  const connection = (await api.connections.list()).find((entry) => entry.id === id);
  if (!connection) throw new Error("Die Verbindung ist in l8db nicht gespeichert.");
  const result = await store(backend, [connection]);
  await remember(api, provider, [id]);
  return result;
}

export async function exportConnections(
  api: L8dbApi,
  backend: VaultBackend,
  name: string,
  provider: string,
) {
  const connections = await api.connections.list();
  if (!connections.length) {
    await api.window.showInformationMessage("Keine gespeicherten Verbindungen vorhanden.");
    return { created: 0, updated: 0 };
  }
  const selected = await pick(api, connections, `In ${name} speichern`);
  if (!selected.length) return { created: 0, updated: 0 };
  const result = await store(backend, selected);
  await remember(
    api,
    provider,
    selected.map((connection) => connection.id),
  );
  await api.window.showInformationMessage(
    `${name}: ${result.created} angelegt, ${result.updated} aktualisiert.`,
  );
  return result;
}

export async function syncConnections(
  api: L8dbApi,
  backend: VaultBackend,
  provider: string,
): Promise<SyncResult> {
  const connections = unique(await backend.list());
  const key = `synced_${slug(provider)}`;
  const knownKey = `known_${slug(provider)}`;
  const before = await tracked(api, key);
  const known = await tracked(api, knownKey);
  const local = new Set((await api.connections.list()).map((connection) => connection.id));
  const hidden = new Set((known ?? []).filter((id) => !local.has(id)));
  const visible = connections.filter((connection) => !hidden.has(connection.id));
  const saved = visible.length
    ? await api.connections.save(visible)
    : { added: 0, updated: 0, skipped: [] };
  const ids = new Set(connections.map((connection) => connection.id));
  const stale = (before ?? []).filter((id) => !ids.has(id) && local.has(id));
  const removed =
    stale.length && typeof api.connections.remove === "function"
      ? await api.connections.remove(stale)
      : 0;
  if (before) {
    const owned = new Set(before);
    await api.storage
      .set(
        key,
        [...ids].filter((id) => owned.has(id) || !local.has(id)),
      )
      .catch(() => undefined);
  }
  if (known) await api.storage.set(knownKey, [...ids]).catch(() => undefined);
  return {
    total: visible.length - saved.skipped.length,
    added: saved.added,
    updated: saved.updated,
    removed,
    hidden: connections.length - visible.length,
    skipped: saved.skipped,
  };
}

export function syncSummary(result: SyncResult, name: string) {
  if (!result.total && !result.removed && !result.hidden && !result.skipped.length)
    return `In ${name} sind noch keine Datenbank-Zugänge für l8db hinterlegt.`;
  const changes = [
    result.added && `${result.added} neu`,
    result.removed && `${result.removed} entfernt`,
    result.hidden && `${result.hidden} ausgeblendet`,
    result.skipped.length && `nicht lesbar: ${result.skipped.join(", ")}`,
  ].filter(Boolean);
  return `${result.total === 1 ? "1 Datenbank-Zugang" : `${result.total} Datenbank-Zugänge`} aus ${name} bereit${changes.length ? ` (${changes.join(", ")})` : ""}.`;
}

const OP_LINUX = [
  'set -e; [ "$(uname -s)" = Linux ]',
  'case "$(uname -m)" in x86_64) a=amd64;; aarch64|arm64) a=arm64;; *) a=386;; esac',
  'v=v2.30.3; d="$HOME/.local/bin"; t="$(mktemp -d)"; mkdir -p "$d"',
  'curl -fsSLo "$t/op.zip" "https://cache.agilebits.com/dist/1P/op2/pkg/$v/op_linux_${a}_$v.zip"',
  'unzip -o -q "$t/op.zip" op -d "$d"; chmod +x "$d/op"; rm -rf "$t"',
].join("\n");
const KEEPER_VENV = [
  'set -e; d="$HOME/.local/share/l8db/keeper"; python3 -m venv "$d"',
  '"$d/bin/pip" install -q keepercommander; mkdir -p "$HOME/.local/bin"',
  'ln -sf "$d/bin/keeper" "$HOME/.local/bin/keeper"',
].join("\n");
const WINGET = ["-e", "--silent", "--accept-source-agreements", "--accept-package-agreements"];

export const binaries: Record<string, string> = {
  keeper: "keeper",
  bitwarden: "bw",
  "1password": "op",
};

export const installers: Record<string, string[][]> = {
  keeper: [
    ["pipx", "install", "keepercommander"],
    ["python3", "-m", "pip", "install", "--user", "keepercommander"],
    ["sh", "-c", KEEPER_VENV],
    ["py", "-m", "pip", "install", "--user", "keepercommander"],
  ],
  bitwarden: [
    ["npm", "install", "-g", "@bitwarden/cli"],
    ["brew", "install", "bitwarden-cli"],
    ["winget", "install", "--id", "Bitwarden.CLI", ...WINGET],
  ],
  "1password": [
    ["brew", "install", "--cask", "1password-cli"],
    ["winget", "install", "--id", "AgileBits.1Password.CLI", ...WINGET],
    ["sh", "-c", OP_LINUX],
  ],
};

const manualInstall: Record<string, string> = {
  keeper: "https://docs.keeper.io/en/keeperpam/commander-cli/commander-installation-setup",
  bitwarden: "https://bitwarden.com/help/cli/#download-and-install",
  "1password": "https://developer.1password.com/docs/cli/get-started/",
};

export async function cliVersion(api: L8dbApi, provider: string): Promise<string | null> {
  try {
    const result = await api.process.run(binaries[provider], {
      args: ["--version"],
      timeoutMs: 60000,
    });
    if (result.status !== 0) return null;
    const line = (result.stdout || result.stderr).trim().split("\n").pop()?.trim();
    return line?.match(/\d+(?:\.\d+)+/)?.[0] ?? (line || "installiert");
  } catch {
    return null;
  }
}

export async function installCli(api: L8dbApi, provider: string): Promise<string> {
  const errors: string[] = [];
  for (const [command, ...args] of installers[provider] ?? []) {
    let result: Awaited<ReturnType<L8dbApi["process"]["run"]>>;
    try {
      result = await api.process.run(command, { args, timeoutMs: 600000 });
    } catch {
      continue;
    }
    if (result.status === 0) {
      const version = await cliVersion(api, provider);
      if (version) return version;
    }
    errors.push(`${command}: ${(result.stderr || result.stdout).trim().slice(-300)}`);
  }
  throw new Error(
    `${labels[provider] ?? provider}-CLI konnte nicht automatisch installiert werden${errors.length ? ` (${errors.join(" | ")})` : ": kein passender Paketmanager gefunden"}. Manuelle Anleitung: ${manualInstall[provider]}`,
  );
}

type AccountState = Omit<VaultStatus, "provider" | "cli">;

interface VaultAccount {
  status(api: L8dbApi, auth: VaultSession): Promise<AccountState>;
  login(api: L8dbApi, auth: VaultSession, input: VaultLogin): Promise<VaultPrompt | undefined>;
  answer?(api: L8dbApi, auth: VaultSession, input: VaultLogin): Promise<VaultPrompt | undefined>;
  logout(api: L8dbApi, auth: VaultSession): Promise<void>;
}

const BW_CODE = /code is required|no provider selected/i;

async function bitwardenState(api: L8dbApi, auth: VaultSession): Promise<AccountState> {
  const raw = json(
    await run(api, "bw", ["status", ...(auth.bw ? ["--session", auth.bw] : [])]),
  ) as { status?: string; userEmail?: string | null; serverUrl?: string | null };
  if (raw.status !== "unlocked") auth.bw = null;
  return {
    state:
      raw.status === "unlocked" ? "signed-in" : raw.status === "locked" ? "locked" : "signed-out",
    account: raw.userEmail ?? undefined,
    server: raw.serverUrl ?? undefined,
  };
}

async function onePasswordAccounts(api: L8dbApi) {
  const found = json((await run(api, "op", ["account", "list", "--format", "json"])) || "[]");
  return (Array.isArray(found) ? found : [])
    .filter((entry) => typeof entry?.account_uuid === "string")
    .map((entry) => ({
      id: entry.account_uuid as string,
      label: [entry.email, entry.url].filter(Boolean).join(" · ") || (entry.account_uuid as string),
    }));
}

function keeperTarget(input: VaultLogin) {
  return [...(input.server ? ["--server", input.server] : []), "--user", input.email ?? ""];
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]|\\r`, "g");
const KEEPER_CHANNELS: [RegExp, string][] = [
  [/^TOTP \(.*?\)/, "Authenticator-App"],
  [/^Send SMS Code/, "SMS"],
  [/^WebAuthN \(.*?\)/, "Sicherheitsschlüssel"],
  [/^Backup Codes/, "Backup-Code"],
];
const KEEPER_EXPIRED = "Die Keeper-Anmeldung ist abgelaufen. Bitte melde dich erneut an.";

async function keeperStop(auth: VaultSession) {
  const pending = auth.keeper;
  auth.keeper = null;
  await pending?.session.stop().catch(() => undefined);
}

async function keeperPrompt(api: L8dbApi, auth: VaultSession): Promise<VaultPrompt | undefined> {
  const pending = auth.keeper;
  if (!pending) throw new Error(KEEPER_EXPIRED);
  let text = "";
  let log = "";
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    const chunk = await pending.session.read(1000).catch(() => null);
    if (!chunk) {
      auth.keeper = null;
      throw new Error(KEEPER_EXPIRED);
    }
    const output = chunk.output.replace(ANSI, "");
    text += output;
    log += output;
    if (chunk.exited) {
      auth.keeper = null;
      const status = await run(api, "keeper", ["--batch-mode", "login-status"]).catch(() => "");
      if (!/^Logged in$/m.test(status)) {
        const reason = log.trim().split("\n").pop()?.trim().slice(0, 300);
        throw new Error(`Keeper-Anmeldung fehlgeschlagen${reason ? `: ${reason}` : "."}`);
      }
      await run(api, "keeper", ["--batch-mode", "this-device", "timeout", "30d"]).catch(
        () => undefined,
      );
      return undefined;
    }
    const detail = /invalid/i.test(log) ? "Keeper hat den Code nicht akzeptiert." : undefined;
    const factor = text.lastIndexOf("Two-Factor Authentication Required");
    let prompt: VaultPrompt | null = null;
    if (/Selection \(or Enter to check status\): ?$/.test(text))
      prompt = { needs: "device", detail };
    else if (/Enter 2FA Code: ?$/.test(text)) prompt = { needs: "code", detail };
    else if (factor >= 0 && /Selection: ?$/.test(text)) {
      const channels = [...text.slice(factor).matchAll(/^\s*(\d+)\.\s+(.+?)\s*$/gm)].map(
        ([, id, label]) => ({
          id,
          label: KEEPER_CHANNELS.reduce((name, [from, to]) => name.replace(from, to), label),
        }),
      );
      if (channels.length === 1) {
        await pending.session.write("1\n");
        text = "";
        continue;
      }
      prompt = { needs: "2fa", channels, detail };
    } else if (/Password: ?$/.test(text)) {
      await keeperStop(auth);
      throw new Error("Keeper hat das Master-Passwort abgelehnt.");
    } else if (!chunk.output && /: ?$/.test(text)) {
      await keeperStop(auth);
      return { needs: "terminal" };
    }
    if (prompt) {
      pending.needs = prompt.needs;
      return prompt;
    }
  }
  await keeperStop(auth);
  throw new Error("Keeper antwortet nicht. Bitte versuche es erneut.");
}

const DEVICE_METHODS: Record<string, string> = { email: "1", push: "2", sms: "3" };

export const accounts: Record<string, VaultAccount> = {
  bitwarden: {
    status: bitwardenState,
    async login(api, auth, input) {
      const current = await bitwardenState(api, auth);
      const env = { L8DB_BW_PASSWORD: input.password ?? "" };
      if (current.state === "signed-out") {
        if (input.server) await run(api, "bw", ["config", "server", input.server]);
        if (input.clientId) {
          await run(api, "bw", ["login", "--apikey", "--nointeraction"], {
            BW_CLIENTID: input.clientId,
            BW_CLIENTSECRET: input.clientSecret ?? "",
          });
        } else {
          try {
            auth.bw = (
              await run(
                api,
                "bw",
                [
                  "login",
                  input.email ?? "",
                  "--passwordenv",
                  "L8DB_BW_PASSWORD",
                  "--raw",
                  "--nointeraction",
                  ...(input.method ? ["--method", input.method] : []),
                  ...(input.code ? ["--code", input.code] : []),
                ],
                env,
              )
            ).trim();
          } catch (error) {
            if (!BW_CODE.test(String(error))) throw error;
            if (!input.code) return { needs: "code" };
            throw new Error(
              "Bitwarden verlangt eine zusätzliche Bestätigung dieses Geräts. Melde dich stattdessen mit API-Schlüssel an.",
            );
          }
        }
      }
      if (!auth.bw)
        auth.bw = (
          await run(
            api,
            "bw",
            ["unlock", "--raw", "--passwordenv", "L8DB_BW_PASSWORD", "--nointeraction"],
            env,
          )
        ).trim();
      await run(api, "bw", ["sync", "--session", auth.bw]);
    },
    async logout(api, auth) {
      auth.bw = null;
      await run(api, "bw", ["logout"]).catch(() => undefined);
    },
  },
  "1password": {
    async status(api, auth) {
      const list = await onePasswordAccounts(api);
      if (!auth.op || !list.some((entry) => entry.id === auth.op)) auth.op = list[0]?.id ?? null;
      if (!auth.op) return { state: "signed-out", accounts: list };
      try {
        const me = json(
          await run(api, "op", ["whoami", "--format", "json", "--account", auth.op]),
        ) as { email?: string; url?: string };
        return { state: "signed-in", account: me.email, server: me.url, accounts: list };
      } catch {
        return { state: "locked", accounts: list };
      }
    },
    async login(api, auth, input) {
      const list = await onePasswordAccounts(api);
      auth.op = list.find((entry) => entry.id === input.account)?.id ?? list[0]?.id ?? null;
      if (!auth.op)
        throw new Error(
          "Keine 1Password-Konten gefunden. Aktiviere in der 1Password-App unter Einstellungen → Entwickler „Mit 1Password CLI integrieren“ und versuche es erneut.",
        );
      await run(api, "op", ["vault", "list", "--format", "json", "--account", auth.op]);
      return undefined;
    },
    async logout(api, auth) {
      if (auth.op) await run(api, "op", ["signout", "--account", auth.op]).catch(() => undefined);
    },
  },
  keeper: {
    async status(api) {
      if (!/^Logged in$/m.test(await run(api, "keeper", ["--batch-mode", "login-status"])))
        return { state: "signed-out" };
      try {
        const me = json(await run(api, "keeper", ["--batch-mode", "whoami", "--json"])) as {
          user?: string;
          data_center?: string;
        };
        return { state: "signed-in", account: me.user, server: me.data_center };
      } catch {
        return { state: "signed-in" };
      }
    },
    async login(api, auth, input) {
      await keeperStop(auth);
      const session = await api.process.start("keeper", {
        args: ["--batch-mode", ...keeperTarget(input), "this-device", "persistent-login", "on"],
        env: { KEEPER_PASSWORD: input.password ?? "" },
        timeoutMs: 600000,
      });
      auth.keeper = { session, needs: undefined };
      return keeperPrompt(api, auth);
    },
    async answer(api, auth, input) {
      const pending = auth.keeper;
      if (!pending) throw new Error(KEEPER_EXPIRED);
      const code = (input.code ?? "").replace(/[^\x21-\x7e]/g, "");
      let line: string;
      if (pending.needs === "device")
        line = DEVICE_METHODS[input.method ?? ""] ?? (code ? `c ${code}` : "");
      else if (pending.needs === "2fa" && /^\d{1,2}$/.test(input.channel ?? ""))
        line = input.channel as string;
      else if (pending.needs === "code" && code) line = code;
      else throw new Error("Bitte gib den Code ein.");
      await pending.session.write(`${line}\n`);
      const prompt = await keeperPrompt(api, auth);
      if (prompt?.needs === "device" && !line && !prompt.detail)
        return { ...prompt, detail: "Das Gerät ist noch nicht freigegeben." };
      return prompt;
    },
    async logout(api, auth) {
      await keeperStop(auth);
      await run(api, "keeper", ["--batch-mode", "logout"]).catch(() => undefined);
    },
  },
};

export async function vaultStatus(
  api: L8dbApi,
  provider: string,
  auth: VaultSession,
): Promise<VaultStatus> {
  const cli = await cliVersion(api, provider);
  if (!cli) return { provider, cli, state: "signed-out" };
  return { provider, cli, ...(await accounts[provider].status(api, auth)) };
}

export async function vaultSetup(
  api: L8dbApi,
  auth: VaultSession,
  request: VaultLogin & { action?: string; provider?: string },
  fallback: string,
): Promise<VaultStatus> {
  const provider = request.provider && request.provider in binaries ? request.provider : fallback;
  let prompt: VaultPrompt | undefined;
  if (request.action === "install") await installCli(api, provider);
  if (request.action === "login") prompt = await accounts[provider].login(api, auth, request);
  if (request.action === "answer") prompt = await accounts[provider].answer?.(api, auth, request);
  if (request.action === "logout") await accounts[provider].logout(api, auth);
  const status = await vaultStatus(api, provider, auth);
  return prompt?.needs && status.state !== "signed-in" ? { ...status, ...prompt } : status;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function activate(context: ExtensionContext, api: L8dbApi): void {
  const cache = new Map<string, VaultBackend>();
  const auth: VaultSession = { bw: null, op: null };
  const configured = async () =>
    (await api.configuration.get<string>("vault.provider")) || "keeper";
  const resolve = async () => {
    const provider = await configured();
    const factory = backends[provider];
    if (!factory) throw new Error(`Unbekannter Passwortmanager: ${provider}`);
    if (!cache.has(provider)) cache.set(provider, factory(api, auth));
    return {
      backend: cache.get(provider) as VaultBackend,
      name: labels[provider] ?? provider,
      provider,
    };
  };
  const status = (update: Parameters<L8dbApi["statusBar"]["set"]>[1]) =>
    api.statusBar.set("vault.status", update).catch(() => undefined);
  let running: Promise<SyncResult> | null = null;
  const sync = async (quiet: boolean): Promise<SyncResult> => {
    running ??= (async () => {
      const { backend, name, provider } = await resolve();
      try {
        const result = await syncConnections(api, backend, provider);
        const time = new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
        await status({
          text: `${name}: ${result.total} ${result.total === 1 ? "Zugang" : "Zugänge"}`,
          tooltip: `${syncSummary(result, name)} Stand ${time} Uhr. Klicken zum Aktualisieren.`,
          command: "vault.sync",
        });
        if (!quiet) await api.window.showInformationMessage(syncSummary(result, name));
        return result;
      } catch (error) {
        await status({
          text: `${name}: nicht abgeglichen`,
          tooltip: `${message(error)} Klicken, um es erneut zu versuchen.`,
          command: "vault.sync",
          background: "warning",
        });
        throw error;
      }
    })().finally(() => {
      running = null;
    });
    return running;
  };
  const startup = async () => {
    if ((await api.configuration.get<boolean>("vault.autoSync")) === false) return;
    const provider = await configured();
    if (!backends[provider]) return;
    const current = await vaultStatus(api, provider, auth);
    if (!current.cli || current.state === "signed-out") return;
    if (current.state === "locked") {
      await status({
        text: `${labels[provider]} gesperrt`,
        tooltip: "Klicken, um den Tresor zu entsperren und die Datenbank-Zugänge zu laden.",
        command: "vault.sync",
        background: "warning",
      });
      return;
    }
    await sync(true);
  };
  const guard = (action: typeof exportConnections) => async () => {
    try {
      const { backend, name, provider } = await resolve();
      await action(api, backend, name, provider);
    } catch (error) {
      await api.window.showErrorMessage(message(error));
    }
  };
  const install = async (payload?: unknown) => {
    const provider =
      typeof payload === "string" && payload in binaries ? payload : await configured();
    try {
      const version = await installCli(api, provider);
      await api.window.showInformationMessage(`${labels[provider]}-CLI installiert: ${version}`);
    } catch (error) {
      await api.window.showErrorMessage(message(error));
    }
  };
  void startup().catch((error) => api.logger.warn(`Automatischer Abgleich: ${message(error)}`));
  context.subscriptions.push(
    api.commands.registerCommand("vault.install", (payload) => install(payload)),
    api.commands.registerCommand(
      "vault.setup",
      async (payload) =>
        (await vaultSetup(
          api,
          auth,
          payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {},
          await configured(),
        )) as unknown as Json,
    ),
    api.commands.registerCommand("vault.sync", async (payload) => {
      const quiet =
        !!payload && typeof payload === "object" && !Array.isArray(payload) && !!payload.quiet;
      if (quiet) return (await sync(true)) as unknown as Json;
      try {
        return (await sync(false)) as unknown as Json;
      } catch (error) {
        await api.window.showErrorMessage(message(error));
      }
    }),
    api.commands.registerCommand("vault.save", async (payload) => {
      const id =
        payload && typeof payload === "object" && !Array.isArray(payload) ? payload.id : null;
      if (typeof id !== "string") throw new Error("Verbindungs-ID fehlt.");
      const { backend, provider } = await resolve();
      return await saveConnection(api, backend, provider, id);
    }),
    api.commands.registerCommand("vault.import", guard(importConnections)),
    api.commands.registerCommand("vault.export", guard(exportConnections)),
  );
}

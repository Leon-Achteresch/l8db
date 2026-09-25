import type { ExtensionContext, L8dbApi, VaultConnection } from "@l8db/extension-api";

export const MARKER = "l8db-connection:v1:";
const TITLE_PREFIX = "l8db: ";
const TIMEOUT = 120000;

export interface VaultRecord {
  ref: string;
  connection: VaultConnection;
}

export interface VaultBackend {
  list(): Promise<VaultRecord[]>;
  create(connection: VaultConnection): Promise<void>;
  update(ref: string, connection: VaultConnection): Promise<void>;
}

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
  return MARKER + encode(JSON.stringify(rest));
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
  const fields = (connection: VaultConnection) => [
    ...(username(connection.connectionString)
      ? [`login=$BASE64:${encode(username(connection.connectionString))}`]
      : []),
    ...(connection.password ? [`password=$BASE64:${encode(connection.password)}`] : []),
  ];
  return {
    async list() {
      const found = json((await call("search", "l8db", "-c", "r", "--format", "json")) || "[]");
      const records: VaultRecord[] = [];
      for (const hit of Array.isArray(found) ? found : []) {
        if (
          typeof hit?.record_uid !== "string" ||
          !String(hit.title ?? "").startsWith(TITLE_PREFIX)
        )
          continue;
        const record = json(
          await call("get", hit.record_uid, "--format", "json", "--unmask"),
        ) as Record<string, unknown>;
        const list = Array.isArray(record.fields)
          ? (record.fields as { type?: string; value?: unknown[] }[])
          : [];
        const password =
          list.find((field) => field.type === "password")?.value?.[0] ?? record.password;
        const connection = fromNotes(record.notes, password);
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

export function bitwarden(api: L8dbApi): VaultBackend {
  let session: string | null = null;
  const unlock = async () => {
    if (session) return session;
    const status = json(await run(api, "bw", ["status"])) as { status?: string };
    if (status.status === "unauthenticated")
      throw new Error(
        "Bitwarden CLI ist nicht angemeldet. Bitte zuerst `bw login` im Terminal ausführen.",
      );
    const password = await api.window.showInputBox({
      title: "Bitwarden",
      prompt: "Master-Passwort zum Entsperren",
      password: true,
    });
    if (!password) throw new Error("Abgebrochen.");
    session = (
      await run(api, "bw", ["unlock", "--raw", "--passwordenv", "L8DB_BW_PASSWORD"], {
        L8DB_BW_PASSWORD: password,
      })
    ).trim();
    await run(api, "bw", ["sync", "--session", session]);
    return session;
  };
  const call = async (...args: string[]) => run(api, "bw", [...args, "--session", await unlock()]);
  const items = new Map<string, Record<string, unknown>>();
  const body = (connection: VaultConnection, base: Record<string, unknown> = {}) =>
    encode(
      JSON.stringify({
        type: 1,
        ...base,
        name: title(connection),
        notes: toNotes(connection),
        login: {
          ...((base.login as Record<string, unknown>) ?? {}),
          username: username(connection.connectionString) || null,
          password: connection.password,
        },
      }),
    );
  return {
    async list() {
      const found = json(await call("list", "items", "--search", TITLE_PREFIX.trim()));
      const records: VaultRecord[] = [];
      for (const item of Array.isArray(found) ? found : []) {
        const connection = fromNotes(item?.notes, item?.login?.password);
        if (!connection || typeof item.id !== "string") continue;
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

export function onePassword(api: L8dbApi): VaultBackend {
  const call = (...args: string[]) => run(api, "op", args);
  const assignments = (connection: VaultConnection) => [
    `username=${username(connection.connectionString)}`,
    `password=${connection.password ?? ""}`,
    `notesPlain=${toNotes(connection)}`,
  ];
  return {
    async list() {
      const found = json(
        (await call("item", "list", "--tags", "l8db", "--format", "json")) || "[]",
      );
      const records: VaultRecord[] = [];
      for (const hit of Array.isArray(found) ? found : []) {
        if (typeof hit?.id !== "string") continue;
        const item = json(await call("item", "get", hit.id, "--format", "json", "--reveal")) as {
          fields?: { id?: string; purpose?: string; value?: unknown }[];
        };
        const field = (id: string, purpose: string) =>
          item.fields?.find((f) => f.id === id || f.purpose === purpose)?.value;
        const connection = fromNotes(field("notesPlain", "NOTES"), field("password", "PASSWORD"));
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

export const backends: Record<string, (api: L8dbApi) => VaultBackend> = {
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

export async function importConnections(api: L8dbApi, backend: VaultBackend, name: string) {
  const records = await backend.list();
  if (!records.length) {
    await api.window.showInformationMessage(`Keine l8db-Verbindungen in ${name} gefunden.`);
    return { added: 0, updated: 0, skipped: [] };
  }
  const selected = await pick(
    api,
    [...new Map(records.map((record) => [record.connection.id, record.connection])).values()],
    `Aus ${name} laden`,
  );
  if (!selected.length) return { added: 0, updated: 0, skipped: [] };
  const result = await api.connections.save(selected);
  await api.window.showInformationMessage(
    `${name}: ${result.added} neu, ${result.updated} aktualisiert${result.skipped.length ? `, übersprungen: ${result.skipped.join(", ")}` : ""}.`,
  );
  return result;
}

export async function exportConnections(api: L8dbApi, backend: VaultBackend, name: string) {
  const connections = await api.connections.list();
  if (!connections.length) {
    await api.window.showInformationMessage("Keine gespeicherten Verbindungen vorhanden.");
    return { created: 0, updated: 0 };
  }
  const selected = await pick(api, connections, `In ${name} speichern`);
  if (!selected.length) return { created: 0, updated: 0 };
  const existing = new Map(
    (await backend.list()).map((record) => [record.connection.id, record.ref]),
  );
  let created = 0;
  let updated = 0;
  for (const connection of selected) {
    const ref = existing.get(connection.id);
    if (ref) {
      await backend.update(ref, connection);
      updated++;
    } else {
      await backend.create(connection);
      created++;
    }
  }
  await api.window.showInformationMessage(`${name}: ${created} angelegt, ${updated} aktualisiert.`);
  return { created, updated };
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
    return (result.stdout || result.stderr).trim().split("\n").pop()?.trim() || "installiert";
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

async function refreshView(api: L8dbApi, busy?: string) {
  const items = await Promise.all(
    Object.keys(binaries).map(async (provider) => {
      const version = busy === provider ? null : await cliVersion(api, provider);
      return {
        id: provider,
        label: labels[provider],
        icon: "package",
        description: busy === provider ? "wird installiert …" : (version ?? "nicht installiert"),
        ...(version || busy === provider
          ? {}
          : { badge: "Installieren", command: "vault.install", commandArguments: provider }),
      };
    }),
  );
  await api.views.setTreeData("vault.clis", [
    ...items,
    { id: "import", label: "Verbindungen laden", icon: "database", command: "vault.import" },
    { id: "export", label: "Verbindungen speichern", icon: "database", command: "vault.export" },
  ]);
}

export function activate(context: ExtensionContext, api: L8dbApi): void {
  const cache = new Map<string, VaultBackend>();
  const resolve = async () => {
    const provider = (await api.configuration.get<string>("vault.provider")) || "keeper";
    const factory = backends[provider];
    if (!factory) throw new Error(`Unbekannter Passwortmanager: ${provider}`);
    if (!cache.has(provider)) cache.set(provider, factory(api));
    return { backend: cache.get(provider) as VaultBackend, name: labels[provider] ?? provider };
  };
  const guard = (action: typeof importConnections | typeof exportConnections) => async () => {
    try {
      const { backend, name } = await resolve();
      await action(api, backend, name);
    } catch (error) {
      await api.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const install = async (payload?: unknown) => {
    const provider =
      typeof payload === "string" && payload in binaries
        ? payload
        : (await api.configuration.get<string>("vault.provider")) || "keeper";
    try {
      await refreshView(api, provider);
      const version = await installCli(api, provider);
      await api.window.showInformationMessage(`${labels[provider]}-CLI installiert: ${version}`);
    } catch (error) {
      await api.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      await refreshView(api);
    }
  };
  void refreshView(api).catch(() => undefined);
  context.subscriptions.push(
    api.commands.registerCommand("vault.install", (payload) => install(payload)),
    api.commands.registerCommand("vault.refresh", () => refreshView(api)),
    api.commands.registerCommand("vault.import", guard(importConnections)),
    api.commands.registerCommand("vault.export", guard(exportConnections)),
  );
}

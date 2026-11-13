import { type ConnectionInput, useConnectionsStore } from "@/lib/connections";

export const DEMO_DB_FILE = "l8db-lernen-shop.sqlite";
export const DEMO_CONNECTION_NAME = "Demo-Shop";
export const DEMO_MARKER_TABLE = "l8db_demo_marker";
export const DEMO_ROWS = { customers: 200, products: 50, orders: 500, order_items: 500 } as const;

const FIRST = ["Anna", "Ben", "Clara", "David", "Emma", "Felix", "Greta", "Hannes"];
const LAST = ["Müller", "Schmidt", "Weber", "Wagner", "Becker", "Hoffmann", "Koch"];
const CITIES = ["Berlin", "Hamburg", "München", "Köln", "Leipzig", "Bremen"];
const CATEGORIES = ["Bücher", "Elektronik", "Garten", "Küche", "Spiele"];
const PRODUCTS = ["Lampe", "Tasse", "Kabel", "Roman", "Schaufel", "Brettspiel", "Topf", "Maus"];
const STATUS = ["offen", "bezahlt", "versendet", "geliefert", "storniert"];

function pick(expression: string, values: readonly string[]): string {
  const cases = values.map((value, index) => `WHEN ${index} THEN '${value}'`).join(" ");
  return `CASE (${expression}) % ${values.length} ${cases} END`;
}

function series(limit: number): string {
  return `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${limit})`;
}

export function demoSeedSql(rows: typeof DEMO_ROWS = DEMO_ROWS): string {
  return [
    "BEGIN",
    `CREATE TABLE IF NOT EXISTS ${DEMO_MARKER_TABLE} (created_by TEXT NOT NULL)`,
    `DELETE FROM ${DEMO_MARKER_TABLE}`,
    `INSERT INTO ${DEMO_MARKER_TABLE} VALUES ('l8db')`,
    "DROP TABLE IF EXISTS order_items",
    "DROP TABLE IF EXISTS orders",
    "DROP TABLE IF EXISTS products",
    "DROP TABLE IF EXISTS customers",
    "CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, city TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price REAL NOT NULL)",
    "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), ordered_at TEXT NOT NULL, status TEXT NOT NULL)",
    "CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, unit_price REAL NOT NULL)",
    `${series(rows.customers)} INSERT INTO customers SELECT i, ${pick("i", FIRST)} || ' ' || ${pick("i * 3", LAST)}, 'kunde' || i || '@example.com', ${pick("i * 7", CITIES)}, date('2024-01-01', '+' || (i * 5 % 365) || ' days') FROM n`,
    `${series(rows.products)} INSERT INTO products SELECT i, ${pick("i", PRODUCTS)} || ' ' || i, ${pick("i * 2", CATEGORIES)}, round(4.99 + (i * 37 % 200) + 0.5, 2) FROM n`,
    `${series(rows.orders)} INSERT INTO orders SELECT i, 1 + (i * 13 % ${rows.customers}), date('2025-01-01', '+' || (i * 11 % 300) || ' days'), ${pick("i * 5", STATUS)} FROM n`,
    `${series(rows.order_items)} INSERT INTO order_items SELECT i, 1 + (i * 7 % ${rows.orders}), 1 + (i * 17 % ${rows.products}), 1 + (i % 4), round(4.99 + (i * 29 % 200) + 0.5, 2) FROM n`,
    "COMMIT",
  ].join(";\n");
}

export function demoDatabasePath(directory: string): string {
  const separator = directory.includes("\\") && !directory.includes("/") ? "\\" : "/";
  const base = directory.replace(/[\\/]+$/, "");
  return `${base}${separator}${DEMO_DB_FILE}`;
}

export function demoConnectionInput(path: string): ConnectionInput {
  return {
    name: DEMO_CONNECTION_NAME,
    kind: "sqlite",
    connectionString: path,
    sslMode: "disable",
    ssh: null,
    environment: "development",
  };
}

export interface DemoDatabaseDeps {
  directory: () => Promise<string>;
  execute: (connectionString: string, sql: string) => Promise<unknown>;
  activate: (id: string | null) => Promise<boolean>;
}

export class ForeignDemoFileError extends Error {
  constructor(path: string) {
    super(`${path} stammt nicht von l8db`);
    this.name = "ForeignDemoFileError";
  }
}

const TABLES_SQL = "SELECT name FROM sqlite_master WHERE type = 'table'";

function tableNames(result: unknown): string[] {
  const rows = (result as { rows?: Record<string, unknown>[] } | null | undefined)?.rows;
  return Array.isArray(rows) ? rows.map((row) => String(row.name)) : [];
}

export function seedAllowed(tables: readonly string[]): boolean {
  return tables.length === 0 || tables.includes(DEMO_MARKER_TABLE);
}

async function defaultDeps(): Promise<DemoDatabaseDeps> {
  const [{ appCacheDir }, { mkdir }, { executeQuery }, { activateConnectionWithToast }] =
    await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
      import("@/lib/db"),
      import("@/lib/ssh"),
    ]);
  return {
    directory: async () => {
      const directory = await appCacheDir();
      await mkdir(directory, { recursive: true });
      return directory;
    },
    execute: (connectionString, sql) =>
      executeQuery("sqlite", connectionString, sql, undefined, { confirmed: true }),
    activate: activateConnectionWithToast,
  };
}

export interface OpenedDemoDatabase {
  connectionId: string;
  previousId: string | null;
}

export async function openDemoDatabase(
  deps?: DemoDatabaseDeps,
): Promise<OpenedDemoDatabase | null> {
  const resolved = deps ?? (await defaultDeps());
  const path = demoDatabasePath(await resolved.directory());
  const target = `${path}?mode=rwc`;
  if (!seedAllowed(tableNames(await resolved.execute(target, TABLES_SQL))))
    throw new ForeignDemoFileError(path);
  await resolved.execute(target, demoSeedSql());
  const connection = useConnectionsStore
    .getState()
    .addTemporaryConnection(demoConnectionInput(path));
  const previousId = useConnectionsStore.getState().activeId;
  if (await resolved.activate(connection.id)) return { connectionId: connection.id, previousId };
  removeDemoConnection(connection.id);
  return null;
}

export function removeDemoConnection(connectionId: string | null): void {
  const store = useConnectionsStore.getState();
  const demo = store.connections.find((connection) => connection.id === connectionId);
  if (demo?.temporary) store.removeConnection(demo.id);
}

export async function closeDemoDatabase(
  connectionId: string | null,
  previousId: string | null,
  deps?: Pick<DemoDatabaseDeps, "activate">,
): Promise<void> {
  removeDemoConnection(connectionId);
  const previous = previousId
    ? useConnectionsStore.getState().connections.find((connection) => connection.id === previousId)
    : undefined;
  if (!previous) return;
  const resolved = deps ?? (await defaultDeps());
  await resolved.activate(previous.id);
}

export async function activateDemoConnection(
  connectionId: string,
  deps?: Pick<DemoDatabaseDeps, "activate">,
): Promise<boolean> {
  const { connections, activeId } = useConnectionsStore.getState();
  if (activeId === connectionId) return true;
  if (!connections.some((connection) => connection.id === connectionId)) return false;
  const resolved = deps ?? (await defaultDeps());
  return resolved.activate(connectionId);
}

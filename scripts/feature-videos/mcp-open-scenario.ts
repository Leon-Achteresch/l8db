import type { Page } from "playwright";

export async function seedMcpOpenVideo(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const original = internals.invoke;
    const queue: unknown[] = [];
    Object.assign(window, { __mcpOpen: (request: unknown) => queue.push(request) });
    const customers = [
      "Müller GmbH",
      "Schmidt AG",
      "Weber & Co",
      "Becker KG",
      "Hoffmann",
      "Wagner",
    ];
    const statuses = ["offen", "bezahlt", "versendet"];
    const columns = [
      { name: "id", data_type: "integer", is_primary_key: true },
      { name: "customer", data_type: "text", is_primary_key: false },
      { name: "status", data_type: "text", is_primary_key: false },
      { name: "total", data_type: "numeric", is_primary_key: false },
      { name: "created_at", data_type: "date", is_primary_key: false },
    ].map((column, index) => ({
      ...column,
      is_nullable: !column.is_primary_key,
      column_default: null,
      ordinal_position: index + 1,
      character_maximum_length: null,
    }));
    const rows = Array.from({ length: 40 }, (_, i) => ({
      __ctid__: `(0,${i})`,
      id: 1040 + i,
      customer: customers[(i * 5) % customers.length],
      status: statuses[(i * 7) % 3],
      total: ((i * 379) % 1400) + 49.9,
      created_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
    }));
    const visible = (filter: unknown) =>
      filter ? rows.filter((row) => row.status === "offen" && row.total > 500) : rows;
    internals.invoke = async (command, args) => {
      if (command === "mcp_take_open_requests") return queue.splice(0);
      if (command === "list_databases") return ["shop"];
      if (command === "list_schemas") return ["public"];
      if (command === "list_tables")
        return ["customers", "orders", "products"].map((name) => ({ schema: "public", name }));
      if (command === "list_views" || command === "list_materialized_views") return [];
      if (command === "list_table_columns_detailed") return columns;
      if (command === "fetch_table_rows")
        return { columns: columns.map((column) => column.name), rows: visible(args?.filter) };
      if (command === "count_table_rows") return visible(args?.filter).length;
      if (command === "count_table_rows_capped")
        return { count: visible(args?.filter).length, exact: true, estimate: null };
      return original(command, args);
    };
    localStorage.setItem(
      "l8db.connections",
      JSON.stringify({
        state: {
          connections: [
            {
              id: "mcp-video",
              name: "Shop · Beispieldaten",
              kind: "postgres",
              connectionString: "postgres://demo@localhost/shop",
              sslMode: "disable",
            },
          ],
          activeId: "mcp-video",
          favoriteServerKeys: [],
          serverOrder: [],
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "l8db.db-selection",
      JSON.stringify({ state: { databaseByConnection: {}, schemaByConnection: {} }, version: 0 }),
    );
  });
}

export async function chat(page: Page, role: "user" | "ai", text: string): Promise<void> {
  await page.evaluate(
    ({ role, text }) => {
      let panel = document.getElementById("demo-chat");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "demo-chat";
        panel.style.cssText =
          "position:fixed;top:72px;right:24px;width:380px;z-index:20000000;display:flex;flex-direction:column;gap:10px;pointer-events:none;font:500 17px/1.35 system-ui";
        const head = document.createElement("div");
        head.textContent = "Claude · l8db MCP";
        head.style.cssText =
          "align-self:flex-start;color:#c4b5fd;font:600 13px system-ui;letter-spacing:.04em;text-transform:uppercase";
        panel.append(head);
        document.documentElement.append(panel);
      }
      const bubble = document.createElement("div");
      bubble.textContent = text;
      bubble.style.cssText = `padding:12px 16px;border-radius:16px;box-shadow:0 8px 28px #0007;opacity:0;transform:translateY(8px);transition:opacity .35s,transform .35s;${
        role === "user"
          ? "align-self:flex-end;background:#2563eb;color:white;border-bottom-right-radius:4px"
          : "align-self:flex-start;background:#1f1f23f2;color:#e5e5e5;border:1px solid #7c3aed88;border-bottom-left-radius:4px"
      }`;
      panel.append(bubble);
      requestAnimationFrame(() => {
        bubble.style.opacity = "1";
        bubble.style.transform = "none";
      });
    },
    { role, text },
  );
}

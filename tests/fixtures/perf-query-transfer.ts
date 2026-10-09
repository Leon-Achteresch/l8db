import type { Page } from "playwright";

export async function installQueryTransferFixture(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> };
      __queryTransferExports: string[];
    };
    const invoke = state.__TAURI_INTERNALS__.invoke;
    state.__queryTransferExports = [];
    state.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "plugin:dialog|save") return "/fixtures/queries.json";
      if (command === "plugin:fs|write_text_file") {
        state.__queryTransferExports.push(new TextDecoder().decode(args as Uint8Array));
        return;
      }
      if (command === "plugin:dialog|open") return "/fixtures/import.json";
      if (command === "plugin:fs|read_text_file")
        return Array.from(
          new TextEncoder().encode(
            JSON.stringify({
              format: "l8db-saved-queries",
              version: 1,
              queries: [
                { id: "import-perf", name: "Import-Probe", sql: "SELECT 5000", createdAt: 1 },
              ],
            }),
          ),
        );
      return invoke(command, args);
    };
    localStorage.setItem(
      "l8db.saved-queries",
      JSON.stringify({
        state: {
          queries: Array.from({ length: 5000 }, (_, index) => ({
            id: `saved-perf-${index}`,
            name: `Gespeichert ${index}`,
            sql: `SELECT ${index}`,
            createdAt: 1,
          })),
        },
        version: 0,
      }),
    );
    localStorage.setItem(
      "l8db.query-history",
      JSON.stringify({
        state: {
          retentionLimit: 5000,
          entries: Array.from({ length: 5000 }, (_, index) => ({
            id: `query-perf-${index}`,
            connectionId: "perf",
            database: "l8db_perf",
            sql: `SELECT ${index} FROM table_0000`,
            ranAt: 1,
            durationMs: index % 100,
            rowCount: index,
            error: null,
          })),
        },
        version: 0,
      }),
    );
  });
}

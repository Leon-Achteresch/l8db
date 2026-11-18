import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";
import { arrayEditorViteConfig } from "./array-editor-vite";

const registered = [
  "table-edit",
  "table-state",
  "grid-keyboard",
  "keyboard-shell",
  "shared-tab-paste",
  "query-workspace",
  "editor-ai-chat",
  "qol",
  "workbench-qol",
  "compare",
  "compare-three-way",
  "compare-password",
  "data-compare",
  "schema-compare-tabs",
  "split-transaction",
  "transaction-commit",
  "command-palette-pointer",
  "csv-file-check",
  "array-editor-development",
  "routine-result-development",
  "filter-list-import",
  "table-server-output",
  "number-display",
  "table-record",
  "binary-utf8",
  "sql-file-encoding",
];
const requested = process.argv.slice(2);
if (requested.some((name) => !registered.includes(name)))
  throw new Error(`Unbekannte Browserprüfung: ${requested.join(", ")}`);
const files = requested.length ? requested : registered;
const log = "test-artifacts/browser/tests.log";
await mkdir("test-artifacts/browser", { recursive: true });
await writeFile(log, "");
const isolated = files.length === 1 && files[0].endsWith("-development") ? files[0] : null;
const fixturePages: Record<string, string> = {
  "filter-list-import": "tests/fixtures/filter-list.html",
  "table-server-output": "tests/fixtures/table-server-output.html",
  "number-display": "tests/fixtures/number-display.html",
  "table-record": "tests/fixtures/table-record.html",
  "binary-utf8": "tests/fixtures/binary-utf8.html",
  "sql-file-encoding": "tests/fixtures/sql-file-encoding.html",
};
const fixturePage = files.length === 1 ? fixturePages[files[0]] : undefined;
const useIsolatedConfig = Boolean(isolated || fixturePage);
const server = await createServer(
  useIsolatedConfig
    ? arrayEditorViteConfig()
    : {
        cacheDir: "node_modules/.vite-browser-tests",
        optimizeDeps: {
          entries: [
            "index.html",
            "tests/fixtures/table-edit.html",
            "tests/fixtures/table-state.html",
            "tests/fixtures/query-workspace.html",
            "tests/fixtures/editor-ai-chat.html",
            "tests/fixtures/shared-tab-paste.html",
          ],
        },
        server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null, hmr: false },
      },
);
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Fixture server failed to start");
  const url = `http://127.0.0.1:${address.port}`;
  const response = await fetch(
    `${url}/${isolated ? `?${isolated}=1` : (fixturePage ?? "tests/fixtures/table-edit.html")}`,
  );
  if (!response.ok) throw new Error(`Fixture readiness failed: ${response.status}`);
  for (const file of files) {
    const child = Bun.spawn(
      [
        "bun",
        ...(useIsolatedConfig ? ["--no-env-file"] : []),
        "test",
        `tests/${file}-browser.test.ts`,
      ],
      {
        env: {
          ...process.env,
          L8DB_TABLE_BROWSER_URL: url,
          L8DB_QUERY_BROWSER_URL: url,
          L8DB_QOL_BROWSER: "1",
          L8DB_WORKBENCH_BROWSER: "1",
          L8DB_COMPARE_BROWSER: "1",
          L8DB_SCHEMA_COMPARE_BROWSER: "1",
          L8DB_SPLIT_TRANSACTION_BROWSER_URL: url,
          L8DB_PALETTE_BROWSER_URL: url,
          L8DB_KEYBOARD_BROWSER: "1",
          L8DB_SHARED_TAB_BROWSER: "1",
          L8DB_BROWSER_ENGINES: "chromium",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const capture = async (stream: ReadableStream<Uint8Array>) => {
      for await (const chunk of stream) {
        process.stdout.write(chunk);
        await appendFile(log, chunk);
      }
    };
    const [code] = await Promise.all([child.exited, capture(child.stdout), capture(child.stderr)]);
    if (code !== 0) process.exitCode = code;
  }
} finally {
  await server.close();
}

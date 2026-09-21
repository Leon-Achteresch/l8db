import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";

const files = ["table-edit", "table-state", "query-workspace", "qol", "compare", "data-compare"];
const log = "test-artifacts/browser/tests.log";
await mkdir("test-artifacts/browser", { recursive: true });
await writeFile(log, "");
const server = await createServer({
  cacheDir: "node_modules/.vite-browser-tests",
  optimizeDeps: {
    entries: [
      "index.html",
      "tests/fixtures/table-edit.html",
      "tests/fixtures/table-state.html",
      "tests/fixtures/query-workspace.html",
    ],
  },
  server: { host: "127.0.0.1", port: 0, strictPort: false, watch: null, hmr: false },
});
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Fixture server failed to start");
  const url = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${url}/tests/fixtures/table-edit.html`);
  if (!response.ok) throw new Error(`Fixture readiness failed: ${response.status}`);
  for (const file of files) {
    const child = Bun.spawn(["bun", "test", `tests/${file}-browser.test.ts`], {
      env: {
        ...process.env,
        L8DB_TABLE_BROWSER_URL: url,
        L8DB_QUERY_BROWSER_URL: url,
        L8DB_QOL_BROWSER: "1",
        L8DB_COMPARE_BROWSER: "1",
        L8DB_BROWSER_ENGINES: "chromium",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
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

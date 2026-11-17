import { createServer } from "vite";
import { arrayEditorViteConfig } from "./array-editor-vite";

const mode = Bun.argv[2] ?? "--editor";
if (mode !== "--editor" && mode !== "--routine") throw Error("Unknown isolated fixture");
const entry = mode === "--routine" ? "routine-result-development" : "array-editor-development";
const server = await createServer(arrayEditorViteConfig());
let child: ReturnType<typeof Bun.spawn> | undefined;
let interrupted = false;
const stop = () => {
  interrupted = true;
  if (child?.exitCode === null) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw Error("Isolated server unavailable");
  const url = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${url}/?${entry}=1`);
  if (!response.ok) throw Error(`Development readiness failed: ${response.status}`);
  if (interrupted) throw Error("Development launch cancelled");
  child = Bun.spawn(["src-tauri/target/debug/l8db", `--${entry}`], {
    env: { ...process.env, L8DB_A01_EDITOR_DEV_URL: url },
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exitCode = await child.exited;
} finally {
  stop();
  await child?.exited;
  await server.close();
}

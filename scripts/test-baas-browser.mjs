import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const bridgePort = 27032;
const vitePort = 1432;
const env = { ...process.env, L8DB_BAAS_BROWSER: "1" };
const children = [];
let vite;

function start(command, args) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  return child;
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, child, attempts) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (child.exitCode !== null) throw Error(`Service on port ${port} exited`);
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error(`Service on port ${port} did not start`);
}

function cleanup() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
}

try {
  for (const port of [bridgePort, vitePort]) {
    if (await portOpen(port)) throw Error(`Port ${port} is occupied.`);
  }
  const bridge = start("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--no-default-features",
    "--lib",
    "baas_browser_bridge",
    "--",
    "--ignored",
    "--nocapture",
  ]);
  await waitForPort(bridgePort, bridge, 2400);
  vite = await createServer({
    root,
    server: { host: "127.0.0.1", port: vitePort, strictPort: true, hmr: false, watch: null },
  });
  await vite.listen();
  const tests = start("bun", ["test", "tests/baas-self-hosted-browser.test.ts"]);
  const [code] = await once(tests, "exit");
  if (code !== 0) process.exitCode = code ?? 1;
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  await vite?.close();
  cleanup();
}

import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const container = `l8db-redis-test-${process.pid}`;
const valkey = process.env.L8DB_REDIS_VARIANT === "valkey";
const env = {
  ...process.env,
  L8DB_E2E_REDIS_URL: "redis://127.0.0.1:6381",
  L8DB_REDIS_BROWSER: "1",
};
const children = [];
let created = false;

function start(command, args, extra = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...env, ...extra },
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.push(child);
  return child;
}

async function run(command, args, extra = {}) {
  const child = start(command, args, extra);
  const [code] = await once(child, "exit");
  if (code !== 0) throw Error(`${command} exited with ${code}`);
}

async function addressOpen(port, address) {
  return new Promise((resolve) => {
    const socket = net.connect(port, address);
    socket.setTimeout(300);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function portOpen(port) {
  const results = await Promise.all([addressOpen(port, "127.0.0.1"), addressOpen(port, "::1")]);
  return results.some(Boolean);
}

async function waitForPort(port, child) {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (child.exitCode !== null) throw Error(`Service on port ${port} exited`);
    if (await portOpen(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw Error(`Service on port ${port} did not start`);
}

async function cleanup() {
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  if (created) {
    created = false;
    await new Promise((resolve) =>
      spawn("docker", ["rm", "-f", container], { stdio: "inherit" }).once("exit", resolve),
    );
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(130);
  });
}

try {
  for (const port of [6381, 6382, 1420]) {
    if (await portOpen(port))
      throw Error(`Port ${port} is occupied. Stop the local test services first.`);
  }
  await run("docker", [
    "run",
    "-d",
    "--name",
    container,
    "-p",
    "127.0.0.1:6381:6379",
    valkey ? "valkey/valkey:8" : "redis:7",
    valkey ? "valkey-server" : "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
    "--databases",
    "32",
  ]);
  created = true;
  await run("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "db::redis",
    "--",
    "--include-ignored",
    "--skip",
    "redis_browser_bridge",
    "--test-threads=1",
  ]);
  const bridge = start("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "redis_browser_bridge",
    "--",
    "--ignored",
    "--nocapture",
  ]);
  await waitForPort(6382, bridge);
  const vite = start("bun", ["run", "dev"]);
  await waitForPort(1420, vite);
  await run("bun", ["test", "tests/redis-commands.test.ts", "tests/redis-browser.test.ts"], {
    L8DB_REDIS_WEBKIT: "",
  });
  await run("bun", ["test", "tests/redis-browser.test.ts"], { L8DB_REDIS_WEBKIT: "1" });
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}

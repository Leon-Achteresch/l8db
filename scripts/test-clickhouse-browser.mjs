import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const container = `l8db-clickhouse-test-${process.pid}`;
const httpPort = 8124;
const http = `http://127.0.0.1:${httpPort}/?user=l8db&password=l8db`;
const env = {
  ...process.env,
  L8DB_E2E_CLICKHOUSE_URL: `clickhouse://l8db:l8db@localhost:${httpPort}/bigdata`,
  L8DB_CLICKHOUSE_BROWSER: "1",
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

async function clickhouse(sql) {
  const response = await fetch(`${http}&max_insert_threads=8&max_execution_time=1200`, {
    method: "POST",
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) throw Error(`ClickHouse: ${text.slice(0, 500)}`);
  return text;
}

async function waitForClickHouse() {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      if ((await clickhouse("SELECT 1")).trim() === "1") return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error("ClickHouse did not start");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await cleanup();
    process.exit(130);
  });
}

try {
  for (const port of [httpPort, 27021, 1420]) {
    if (await portOpen(port))
      throw Error(`Port ${port} is occupied. Stop the local test services first.`);
  }
  await run("docker", [
    "run",
    "-d",
    "--name",
    container,
    "-p",
    `127.0.0.1:${httpPort}:8123`,
    "-e",
    "CLICKHOUSE_USER=l8db",
    "-e",
    "CLICKHOUSE_PASSWORD=l8db",
    "-e",
    "CLICKHOUSE_DB=shop",
    process.env.L8DB_CLICKHOUSE_IMAGE ?? "clickhouse/clickhouse-server:latest",
  ]);
  created = true;
  await waitForClickHouse();
  const seed = await readFile(new URL("./clickhouse-seed-bigdata.sql", import.meta.url), "utf8");
  for (const statement of seed.split(";\n")) {
    if (statement.trim()) await clickhouse(statement.trim());
  }
  const bridge = start("cargo", [
    "test",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "clickhouse_browser_bridge",
    "--",
    "--ignored",
    "--nocapture",
  ]);
  await waitForPort(27021, bridge);
  const vite = start("bun", ["run", "dev"]);
  await waitForPort(1420, vite);
  await run("bun", ["test", "tests/clickhouse-browser.test.ts"], { L8DB_CLICKHOUSE_WEBKIT: "" });
  await run("bun", ["test", "tests/clickhouse-browser.test.ts"], { L8DB_CLICKHOUSE_WEBKIT: "1" });
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  await cleanup();
}

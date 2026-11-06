import { expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { arch, cpus, homedir, platform, totalmem } from "node:os";
import { resolve } from "node:path";

const enabled = process.env.L8DB_PAYMENTS_DENO_LIVE === "1";

test.skipIf(!enabled)(
  "Deno runtime: payments HTTP, raw HMAC, gates, bounded streams and performance",
  async () => {
    const root = resolve(import.meta.dir, "..");
    const binary = process.env.L8DB_DENO_BINARY || Bun.which("deno");
    if (!binary) throw new Error("Set L8DB_DENO_BINARY to an official local Deno executable.");
    const cache = resolve(homedir(), ".cache", "l8db-rexa-deno", "runtime");
    const keys = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_ANON_KEY",
      "L8DB_STRIPE_SECRET_KEY",
      "L8DB_STRIPE_WEBHOOK_SECRET",
      "L8DB_STRIPE_ACCOUNT",
      "L8DB_STRIPE_MODE",
      "L8DB_BILLING_PROJECT",
      "L8DB_BILLING_ORIGIN",
    ];
    const child = Bun.spawn(
      [
        binary,
        "run",
        "--check",
        "--no-config",
        "--no-lock",
        "--no-npm",
        "--cached-only",
        "--allow-net=127.0.0.1",
        `--allow-env=${keys.join(",")}`,
        `--allow-read=${resolve(root, "src-tauri/src/payments")}`,
        resolve(root, "tests/fixtures/payments-deno.check.ts"),
      ],
      {
        cwd: root,
        env: { DENO_DIR: cache, DENO_NO_UPDATE_CHECK: "1", NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const timeout = setTimeout(() => child.kill("SIGTERM"), 45_000);
    let stdout = "";
    let stderr = "";
    let code: number;
    try {
      [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    const artifact = resolve(root, "test-artifacts/payments-deno");
    await mkdir(artifact, { recursive: true });
    await Bun.write(resolve(artifact, "runtime.log"), `${stdout}\n${stderr}`);
    expect(code, `${stdout}\n${stderr}`).toBe(0);
    const line = stdout.split("\n").find((value) => value.startsWith("PAYMENTS_DENO_RESULT "));
    expect(line, stdout).toBeDefined();
    const report = {
      ...JSON.parse((line ?? "").slice("PAYMENTS_DENO_RESULT ".length)),
      environment: {
        os: platform(),
        architecture: arch(),
        cpu: cpus()[0]?.model,
        ramBytes: totalmem(),
        bun: Bun.version,
      },
    };
    await Bun.write(resolve(artifact, "result.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    expect(report.runtime.deno).toBeTruthy();
    expect(report.nativeServers).toBe(2);
    expect(report.idleRequests).toBe(0);
    expect(report.performance.webhookRequests).toBe(31);
    expect(report.performance.checkoutRequests).toBe(31);
  },
  60_000,
);

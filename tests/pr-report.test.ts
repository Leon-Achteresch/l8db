import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type CheckReport,
  parseReport,
  publishReport,
  REPORT_MARKER,
  renderReport,
} from "../scripts/pr-report";

const report: CheckReport = {
  format: 1,
  passed: false,
  checks: [
    {
      id: "orders | <script>",
      kind: "plan",
      status: "failed",
      message: "Plankosten über Grenzwert",
      totalCost: 123,
      seqScans: 1,
      indexSuggestions: [
        {
          schema: "public",
          table: "orders",
          column: "customer_id",
          estimatedTableRows: 100_000,
          estimatedResultRows: 10,
          sql: 'CREATE INDEX CONCURRENTLY "x<y" ON public.orders(customer_id);',
        },
      ],
    },
  ],
};

describe("PR-Bericht", () => {
  test("validiert und maskiert Markup im Kommentar", () => {
    expect(parseReport(report)).toEqual(report);
    expect(() => parseReport({ format: 1, passed: true, checks: [] })).toThrow();
    const body = renderReport(report);
    expect(body).toContain(REPORT_MARKER);
    expect(body).toContain("orders &#124; &lt;script&gt;");
    expect(body).not.toContain("<script>");
    expect(body).toContain("&lt;y");
    const escaped = renderReport({
      format: 1,
      passed: true,
      checks: [
        {
          id: "[click](https://example.com)",
          kind: "scalar_equals",
          status: "passed",
          message: "**ok**",
        },
      ],
    });
    expect(escaped).toContain("\\[click\\]\\(https://example\\.com\\)");
    expect(escaped).toContain("\\*\\*ok\\*\\*");
    expect(() =>
      parseReport({
        format: 1,
        passed: true,
        checks: [{ id: "x", kind: "plan", status: "passed", message: "ok", totalCost: "<script>" }],
      }),
    ).toThrow();
  });

  test("GitHub erstellt einen Kommentar und aktualisiert nur den eigenen", async () => {
    const calls: Array<{ method: string; path: string; auth: string | null; body: string }> = [];
    const notes: Array<{ id: number; body: string; user: { login: string } }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "GET" ? "" : await request.text();
        calls.push({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          auth: request.headers.get("authorization"),
          body,
        });
        if (url.pathname === "/user") return Response.json({ login: "l8db-bot" });
        if (request.method === "GET")
          return Response.json([
            { id: 2, body: REPORT_MARKER, user: { login: "another-user" } },
            ...notes,
          ]);
        if (request.method === "POST") {
          notes.push({ id: 3, body: JSON.parse(body).body, user: { login: "l8db-bot" } });
          return Response.json({ id: 3 }, { status: 201 });
        }
        if (request.method === "PATCH") {
          notes[0].body = JSON.parse(body).body;
          return Response.json(notes[0]);
        }
        return new Response(null, { status: 404 });
      },
    });
    try {
      const options = {
        provider: "github" as const,
        repository: "org/repo",
        number: 7,
        token: "secret",
        apiBase: `http://127.0.0.1:${server.port}`,
      };
      expect(await publishReport(report, options)).toBe("created");
      expect(
        await publishReport(
          {
            ...report,
            passed: true,
            checks: report.checks.map((check) => ({ ...check, status: "passed" as const })),
          },
          options,
        ),
      ).toBe("updated");
      expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
      expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
      expect(calls.find((call) => call.method === "PATCH")?.path).toBe(
        "/repos/org/repo/issues/comments/3",
      );
      expect(calls.every((call) => call.auth === "Bearer secret")).toBe(true);
      expect(notes[0].body).toContain("Prüfbericht ✅");
    } finally {
      server.stop(true);
    }
  });

  test("GitLab aktualisiert vorhandene MR-Notiz mit privatem Token", async () => {
    const calls: Array<{ method: string; path: string; token: string | null }> = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        calls.push({
          method: request.method,
          path: url.pathname,
          token: request.headers.get("private-token"),
        });
        if (url.pathname === "/api/v4/user") return Response.json({ id: 42 });
        if (request.method === "GET")
          return Response.json([{ id: 9, body: REPORT_MARKER, author: { id: 42 } }]);
        if (request.method === "PUT") return Response.json({ id: 9 });
        return new Response(null, { status: 404 });
      },
    });
    try {
      const outcome = await publishReport(report, {
        provider: "gitlab",
        repository: "group/project",
        number: 12,
        token: "secret",
        apiBase: `http://127.0.0.1:${server.port}/api/v4`,
      });
      expect(outcome).toBe("updated");
      expect(calls.map((call) => call.method)).toEqual(["GET", "GET", "PUT"]);
      expect(calls[2].path).toBe("/api/v4/projects/group%2Fproject/merge_requests/12/notes/9");
      expect(calls.every((call) => call.token === "secret")).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("GitLab erstellt einen neuen Bericht und kodiert verschachtelte Projektpfade", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        calls.push({ method: request.method, path: url.pathname });
        if (url.pathname === "/api/v4/user") return Response.json({ id: 42 });
        if (request.method === "GET") return Response.json([]);
        return Response.json({ id: 12 }, { status: 201 });
      },
    });
    try {
      expect(
        await publishReport(report, {
          provider: "gitlab",
          repository: "group/sub/project",
          number: 5,
          token: "secret",
          apiBase: `http://127.0.0.1:${server.port}/api/v4`,
        }),
      ).toBe("created");
      expect(calls.at(-1)).toEqual({
        method: "POST",
        path: "/api/v4/projects/group%2Fsub%2Fproject/merge_requests/5/notes",
      });
    } finally {
      server.stop(true);
    }
  });

  test("GitHub sucht auf weiteren Kommentarseiten vor einer Aktualisierung", async () => {
    let pages = 0;
    let method = "";
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/user") return Response.json({ login: "bot" });
        if (request.method === "GET") {
          pages += 1;
          if (url.searchParams.get("page") === "1") {
            return Response.json(
              Array.from({ length: 100 }, (_, id) => ({
                id,
                body: "unrelated",
                user: { login: "bot" },
              })),
            );
          }
          return Response.json([{ id: 101, body: REPORT_MARKER, user: { login: "bot" } }]);
        }
        method = request.method;
        return Response.json({ id: 101 });
      },
    });
    try {
      expect(
        await publishReport(report, {
          provider: "github",
          repository: "org/repo",
          number: 1,
          token: "secret",
          apiBase: `http://127.0.0.1:${server.port}`,
        }),
      ).toBe("updated");
      expect(pages).toBe(2);
      expect(method).toBe("PATCH");
    } finally {
      server.stop(true);
    }
  });

  test("API-Fehler stoppen ohne neuen Kommentar", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 401 }) });
    try {
      await expect(
        publishReport(report, {
          provider: "github",
          repository: "org/repo",
          number: 1,
          token: "secret",
          apiBase: `http://127.0.0.1:${server.port}`,
        }),
      ).rejects.toThrow("HTTP 401");
    } finally {
      server.stop(true);
    }
  });

  test("Publisher-CLI veröffentlicht und übernimmt den fehlgeschlagenen Prüfstatus", async () => {
    let posted = false;
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === "/user") return Response.json({ login: "bot" });
        if (request.method === "GET") return Response.json([]);
        posted = true;
        return Response.json({ id: 1 }, { status: 201 });
      },
    });
    const dir = mkdtempSync(join(tmpdir(), "l8db-pr-cli-"));
    const file = join(dir, "report.json");
    writeFileSync(file, JSON.stringify(report));
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          "scripts/pr-report.ts",
          "--provider",
          "github",
          "--repository",
          "org/repo",
          "--number",
          "1",
          "--report",
          file,
          "--token-env",
          "L8DB_TEST_PR_TOKEN",
          "--api-base",
          `http://127.0.0.1:${server.port}`,
        ],
        {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env, L8DB_TEST_PR_TOKEN: "secret" },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const exit = await child.exited;
      const stdout = await new Response(child.stdout).text();
      const stderr = await new Response(child.stderr).text();
      expect(exit, stderr).toBe(1);
      expect(stdout).toContain("PR-Bericht erstellt");
      expect(`${stdout}${stderr}`).not.toContain("secret");
      expect(posted).toBe(true);
    } finally {
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import type { Page } from "playwright";
import { seedApp } from "./perf-app";

export async function seedAiWorkspace(page: Page): Promise<void> {
  await seedApp(page, 2, { rows: 2, columns: 2 });
  await page.addInitScript(() => {
    type Event = { kind: string; data: Record<string, unknown> };
    type Channel = { onmessage: (event: Event) => void };
    const mock = {
      requests: [] as Record<string, unknown>[],
      approvals: [] as Record<string, unknown>[],
      responses: [] as Record<string, unknown>[],
      cancels: [] as string[],
      keys: [] as string[],
    };
    Object.assign(window, { aiFixture: mock });
    const runs = new Map<string, { events: Channel; resolve: () => void }>();
    const issueRuns = new Set<string>();
    const issueTitle = "Abfrage-Ergebnis bleibt nach Aktualisieren leer";
    const issueBody =
      "### Beschreibung\nNach dem Aktualisieren bleibt das Ergebnis leer.\n\n### Schritte\n1. Abfrage ausführen\n2. Ergebnis aktualisieren\n\n### Erwartet\nDas Ergebnis wird erneut angezeigt.\n\n### Tatsächlich\nDie Ergebnisansicht bleibt leer.\n\n### Umgebung\n```\nl8db · Demo-Aufnahme\nKeine echten Verbindungs- oder Nutzerdaten.\n```";
    const keys = new Set<string>();
    const setItem = Storage.prototype.setItem;
    const enrich = (value: string) => {
      const data = JSON.parse(value);
      if (!data.state.connections.some((entry: { id: string }) => entry.id === "mentioned"))
        data.state.connections.push({
          id: "mentioned",
          name: "Analytics",
          kind: "postgres",
          connectionString: "postgresql://reader@localhost/analytics",
          sslMode: "disable",
        });
      return JSON.stringify(data);
    };
    Storage.prototype.setItem = function (key, value) {
      setItem.call(this, key, key === "l8db.connections" ? enrich(value) : value);
    };
    const existing = localStorage.getItem("l8db.connections");
    if (existing) localStorage.setItem("l8db.connections", existing);
    let internals = (window as unknown as { __TAURI_INTERNALS__?: Record<string, unknown> })
      .__TAURI_INTERNALS__;
    const wrap = (original: Record<string, unknown>) => ({
      ...original,
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        const profile = args.profile as { id: string; provider: string } | undefined;
        if (command === "ai_environment") return { cwd: "/tmp/ai-fixture" };
        if (command === "ai_status")
          return {
            provider: profile?.provider,
            installed: true,
            version: "fixture",
            keyStored: keys.has(profile?.id ?? ""),
          };
        if (command === "ai_models")
          return {
            models: [
              {
                id: "fixture-model",
                name: "Fixture model",
                efforts: [{ reasoningEffort: "high" }],
                fast: true,
                default: true,
              },
            ],
            modes: {
              availableModes: [
                { id: "plan", name: "Plan" },
                { id: "code", name: "Code" },
              ],
            },
            configOptions: [],
          };
        if (command === "ai_skills")
          return [{ name: "SQL review", path: "/tmp/ai-fixture/.agents/skills/sql/SKILL.md" }];
        if (command === "ai_set_key") {
          if (args.key) keys.add(String(args.id));
          else keys.delete(String(args.id));
          mock.keys.push(String(args.id));
          return;
        }
        if (command === "ai_run") {
          const request = args.request as Record<string, unknown>;
          mock.requests.push(JSON.parse(JSON.stringify(request)));
          const events = args.events as Channel;
          const runId = String(request.runId);
          const last = (request.messages as { role: string; text: string }[]).at(-1)?.text;
          if (last === "Erstelle dafür ein Issue.") {
            issueRuns.add(runId);
            const canvas = document.createElement("canvas");
            canvas.width = 640;
            canvas.height = 200;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Demo-Screenshot fehlt");
            ctx.fillStyle = "#202027";
            ctx.fillRect(0, 0, 640, 200);
            ctx.fillStyle = "#08080b";
            for (let y = 20; y < 180; y += 35) ctx.fillRect(20, y, 580, 20);
            events.onmessage({
              kind: "text",
              data: {
                delta:
                  "Ich habe den Fehlerbericht vorbereitet. Prüfe bitte die Vorschau vor dem Veröffentlichen.",
              },
            });
            events.onmessage({
              kind: "approval",
              data: {
                id: "issue-approval",
                title: "GitHub-Issue erstellen",
                details: {
                  tool: "report_issue",
                  title: issueTitle,
                  body: issueBody,
                  public: "Wird öffentlich angelegt.",
                  screenshot: canvas.toDataURL("image/png"),
                },
              },
            });
            return new Promise<void>((resolve) => runs.set(runId, { events, resolve }));
          }
          if (last === "choice-fixture") {
            events.onmessage({
              kind: "input",
              data: {
                id: "choice",
                title: "Choose scope",
                details: {
                  questions: [
                    {
                      id: "scope",
                      question: "Which scope?",
                      options: [
                        { label: "Schema", description: "Inspect structure" },
                        { label: "Rows", description: "Inspect records" },
                      ],
                    },
                  ],
                },
              },
            });
            return new Promise<void>((resolve) => runs.set(runId, { events, resolve }));
          }
          if (last === "rich-fixture") {
            events.onmessage({
              kind: "text",
              data: {
                delta:
                  "SQL proposal\n```sql\nSELECT id FROM public.users;\n```\n\n| Column | Type |\n| --- | --- |\n| **id** | `integer` |\n| name\\|alias | `text | value` |\n| literal | ``a`|b`` |\n| \\`unfinished | retained |",
              },
            });
            events.onmessage({
              kind: "metadata",
              data: {
                plan: [{ step: "Inspect users", status: "completed" }],
                citations: [{ title: "Database documentation", url: "https://example.com/docs" }],
              },
            });
            events.onmessage({
              kind: "tool",
              data: {
                id: "rich-tool",
                name: "execute_query",
                status: "completed",
                arguments: { connection: "Demo", schema: "public", table: "users" },
                result: {
                  content: [
                    { type: "text", text: "One row returned" },
                    {
                      type: "diff",
                      path: "query.sql",
                      oldText: "SELECT * FROM users;",
                      newText: "SELECT id FROM public.users;",
                    },
                    {
                      type: "image",
                      mimeType: "image/png",
                      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=",
                    },
                  ],
                },
              },
            });
            events.onmessage({
              kind: "approval",
              data: {
                id: "write-approval",
                title: "Write fixture row",
                details: { sql: "UPDATE users SET active = true" },
              },
            });
            return new Promise<void>((resolve) => runs.set(runId, { events, resolve }));
          }
          if (last === "empty-schema" || last === "schema-form") {
            const requestedSchema =
              last === "empty-schema"
                ? { type: "object", properties: {} }
                : {
                    type: "object",
                    properties: {
                      scope: { type: "string", title: "Zugriff", enum: ["Schema", "Zeilen"] },
                      note: { type: "string", title: "Begründung" },
                      views: { type: "boolean", title: "Views einbeziehen" },
                    },
                    required: ["scope", "note"],
                  };
            events.onmessage({
              kind: "input",
              data: {
                id: "schema-request",
                title: last === "empty-schema" ? "MCP-Zugriff bestätigen" : "Zugriff spezifizieren",
                details: {
                  requestedSchema,
                  _meta: { params: { name: "list_tables", connectionName: "Demo" } },
                },
              },
            });
            return new Promise<void>((resolve) => runs.set(runId, { events, resolve }));
          }

          events.onmessage({ kind: "session", data: { sessionId: "native-fixture-session" } });
          if ((request.profile as { provider: string }).provider === "compatible") {
            events.onmessage({ kind: "text", data: { delta: "Local compatible response" } });
            return;
          }
          events.onmessage({ kind: "text", data: { delta: "Streamed schema " } });
          events.onmessage({ kind: "reasoning", data: { delta: "Inspecting selected schemas." } });
          events.onmessage({
            kind: "tool",
            data: {
              id: "tool-1",
              name: "list_tables",
              status: "completed",
              result: { tables: ["users"] },
            },
          });
          events.onmessage({
            kind: "metadata",
            data: {
              models: { availableModels: [{ modelId: "fixture-model", name: "Fixture model" }] },
              modes: { availableModes: [{ id: "plan", name: "Plan" }] },
              tools: ["list_tables"],
            },
          });
          if (mock.requests.length === 1)
            events.onmessage({
              kind: "approval",
              data: {
                id: "approval-1",
                title: "Read fixture schema",
                details: "SELECT * FROM public.users",
              },
            });
          return new Promise<void>((resolve) => runs.set(runId, { events, resolve }));
        }
        if (command === "ai_approve") {
          mock.approvals.push(args);
          const run = runs.get(String(args.runId));
          run?.events.onmessage({
            kind: "approvalResolved",
            data: { id: args.approvalId, allowed: args.allow },
          });
          if (issueRuns.delete(String(args.runId))) {
            if (args.allow) {
              run?.events.onmessage({
                kind: "tool",
                data: {
                  id: "issue-result",
                  name: "report_issue",
                  status: "running",
                  arguments: { title: issueTitle, body: issueBody },
                },
              });
              run?.events.onmessage({
                kind: "tool",
                data: {
                  id: "issue-result",
                  name: "report_issue",
                  status: "completed",
                  result: {
                    content: [
                      {
                        type: "text",
                        text: "Issue erstellt: https://github.com/Leon-Achteresch/l8db/issues/123",
                      },
                    ],
                  },
                },
              });
            } else
              run?.events.onmessage({
                kind: "text",
                data: { delta: "\n\nDer Bericht wurde nicht veröffentlicht." },
              });
            run?.resolve();
            runs.delete(String(args.runId));
            return;
          }
          run?.events.onmessage({
            kind: "input",
            data: {
              id: "question-1",
              title: "Schema focus",
              details: { questions: [{ id: "goal", question: "Describe schema focus" }] },
            },
          });
          return;
        }
        if (command === "ai_respond") {
          mock.responses.push(args);
          const run = runs.get(String(args.runId));
          run?.events.onmessage({ kind: "approvalResolved", data: { id: args.approvalId } });
          run?.events.onmessage({ kind: "text", data: { delta: "complete." } });
          run?.events.onmessage({
            kind: "usage",
            data: {
              context: { used: 1234, size: 32000, cost: { amount: 0.004, currency: "USD" } },
            },
          });
          run?.events.onmessage({
            kind: "usage",
            data: { usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 } },
          });
          run?.resolve();
          runs.delete(String(args.runId));
          return;
        }
        if (command === "ai_cancel") {
          mock.cancels.push(String(args.runId));
          runs.get(String(args.runId))?.resolve();
          runs.delete(String(args.runId));
          return;
        }
        return (
          original.invoke as (command: string, args: Record<string, unknown>) => Promise<unknown>
        )(command, args);
      },
    });
    if (internals) internals = wrap(internals);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      get: () => internals,
      set: (value: Record<string, unknown>) => {
        internals = wrap(value);
      },
    });
  });
}

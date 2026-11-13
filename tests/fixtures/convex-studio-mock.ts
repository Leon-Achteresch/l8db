import type { Page } from "playwright";

export const CONVEX_STUDIO_QUERY = "provider=convex&id=team-1&project=7&deployment=happy-otter-123";

export async function seedConvexStudio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NOW = Date.now();
    const MINUTE = 60_000;
    const rand = (seed: number) => {
      const x = Math.sin(seed * 9301 + 49297) * 233280;
      return x - Math.floor(x);
    };
    const id = (seed: number) =>
      Array.from(
        { length: 32 },
        (_, i) => "abcdefghjkmnpqrstvwxyz0123456789"[Math.floor(rand(seed * 37 + i) * 32)],
      ).join("");

    const TABLES = [
      { name: "messages", documents: 48_210 },
      { name: "channels", documents: 34 },
      { name: "users", documents: 1_284 },
      { name: "reactions", documents: 9_870 },
      { name: "uploads", documents: 412 },
      { name: "presence", documents: 87 },
    ];
    const field = (type: string, optional = false, tableName?: string) => ({
      fieldType: tableName ? { type, tableName } : { type },
      optional,
    });
    const SHAPES: Record<string, Record<string, unknown>> = {
      messages: {
        body: field("string"),
        author: field("id", false, "users"),
        channel: field("id", false, "channels"),
        edited: field("boolean", true),
      },
      channels: { name: field("string"), description: field("string", true) },
      users: { name: field("string"), email: field("string"), role: field("string") },
      reactions: { message: field("id", false, "messages"), emoji: field("string") },
      uploads: { storageId: field("id", false, "_storage"), owner: field("id", false, "users") },
    };
    const NAMES = ["Anna", "Ben", "Clara", "David", "Elif", "Finn", "Greta", "Hannes"];
    const documents = (table: string, count: number) =>
      Array.from({ length: count }, (_, i) => {
        const base = { _id: id(i + table.length * 100), _creationTime: NOW - i * 7 * MINUTE };
        if (table === "messages")
          return {
            ...base,
            body: `Nachricht ${i + 1} im Kanal`,
            author: id(i % 8),
            channel: id(900 + (i % 5)),
            edited: i % 7 === 0,
          };
        if (table === "users")
          return {
            ...base,
            name: NAMES[i % 8],
            email: `${NAMES[i % 8].toLowerCase()}${i}@acme.io`,
            role: i % 9 === 0 ? "admin" : "member",
          };
        if (table === "channels")
          return {
            ...base,
            name: ["general", "engineering", "random", "support", "design"][i % 5],
            description: i % 3 ? "Team-Kanal" : undefined,
          };
        return { ...base, value: i, label: `${table}-${i}` };
      });

    const fn = (name: string, udfType: string, visibility = "public", module = "messages.js") => ({
      name,
      identifier: `${module}:${name}`,
      udfType,
      visibility,
      lineno: 12,
      args: null,
      returns: null,
    });
    const MODULES = [
      {
        path: "messages.js",
        componentId: null,
        componentPath: "",
        functions: [
          fn("list", "query"),
          fn("send", "mutation"),
          fn("remove", "mutation"),
          fn("search", "query"),
        ],
      },
      {
        path: "users.js",
        componentId: null,
        componentPath: "",
        functions: [
          fn("current", "query", "public", "users.js"),
          fn("syncProfile", "action", "internal", "users.js"),
        ],
      },
      {
        path: "crons.js",
        componentId: null,
        componentPath: "",
        functions: [
          fn("cleanupPresence", "mutation", "internal", "crons.js"),
          fn("digest", "action", "internal", "crons.js"),
        ],
      },
    ];
    const FUNCTIONS = MODULES.flatMap((module) => module.functions);
    const buckets = (seed: number) =>
      Array.from({ length: 60 }, (_, i) => {
        const invocations = Math.floor(40 + rand(seed + i) * 220);
        return {
          time: NOW - (59 - i) * MINUTE,
          invocations,
          errors: rand(seed * 3 + i) > 0.86 ? Math.floor(rand(seed + i * 5) * 9) : 0,
          p50Ms: 8 + rand(seed + i * 2) * 30,
          p95Ms: 60 + rand(seed + i * 3) * 240,
        };
      });
    const logEntry = (i: number) => {
      const target = FUNCTIONS[i % FUNCTIONS.length];
      const failed = i % 9 === 4;
      const request = id(5000 + Math.floor(i / 2));
      return {
        kind: "completion",
        executionId: id(7000 + i),
        requestId: request,
        identifier: target.identifier,
        udfType: target.udfType,
        componentPath: null,
        timestampMs: NOW - i * 4200,
        cached: target.udfType === "query" && i % 4 === 0,
        caller: "SyncWorker",
        parentExecutionId: null,
        executionTimeMs: 4 + rand(i) * 180,
        userExecutionTimeMs: 2 + rand(i) * 90,
        success: !failed,
        error: failed
          ? "Uncaught Error: Nicht berechtigt, in diesen Kanal zu schreiben\n    at handler (../convex/messages.ts:18:4)"
          : null,
        lines:
          i % 3 === 0
            ? [
                {
                  level: failed ? "ERROR" : "LOG",
                  message: `'verarbeite' ${i}`,
                  timestampMs: NOW - i * 4200,
                  truncated: false,
                },
              ]
            : [],
        linesDropped: 0,
        usage: {
          database_read_bytes: 2400 + i * 13,
          database_write_bytes: failed ? 0 : 310,
          memory_used_mb: 18,
        },
        returnBytes: 420,
        environment: "isolate",
      };
    };
    const cronRun = (name: string, i: number) => ({
      id: id(300 + i),
      name,
      function: name === "digest" ? "crons.js:digest" : "crons.js:cleanupPresence",
      tsMs: NOW - (i + 1) * 60 * MINUTE,
      status: i === 2 ? "failure" : "success",
      error: i === 2 ? "Zeitüberschreitung beim Versand" : null,
      executionMs: 120 + i * 30,
      logLines: [],
      truncated: false,
    });
    let logCalls = 0;

    const invoke = async (command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case "convex_profiles":
          return [{ id: "team-1", team_id: 1, url: null }];
        case "convex_projects":
          return {
            items: [
              {
                id: 7,
                name: "acme-chat",
                slug: "acme-chat",
                teamSlug: "acme",
                prodDeploymentName: "happy-otter-123",
                devDeploymentName: "quiet-lynx-456",
              },
              {
                id: 8,
                name: "acme-shop",
                slug: "acme-shop",
                teamSlug: "acme",
                prodDeploymentName: "brave-heron-789",
                devDeploymentName: null,
              },
            ],
            pagination: { hasMore: false, nextCursor: null },
          };
        case "convex_deployments":
          return [
            {
              name: "happy-otter-123",
              deploymentType: "prod",
              reference: null,
              region: "aws-eu-west-1",
              deploymentUrl: "https://happy-otter-123.convex.cloud",
              kind: "cloud",
              isDefault: true,
            },
            {
              name: "quiet-lynx-456",
              deploymentType: "dev",
              reference: null,
              region: "aws-eu-west-1",
              deploymentUrl: "https://quiet-lynx-456.convex.cloud",
              kind: "cloud",
              isDefault: false,
            },
          ];
        case "convex_environment_variables":
          return ["OPENAI_API_KEY", "RESEND_API_KEY", "SITE_URL", "STRIPE_WEBHOOK_SECRET"];
        case "convex_studio_settings_env_reveal":
          return "sk-mock-value";
        case "convex_studio_data_tables":
          return { tables: TABLES, has_more: false };
        case "convex_studio_data_documents":
          return { documents: documents(String(args.table), 50), cursor: null, has_more: false };
        case "convex_studio_data_schema":
          return {
            has_schema: true,
            schema_validation: true,
            tables: TABLES.filter((table) => SHAPES[table.name]).map((table) => ({
              tableName: table.name,
              indexes:
                table.name === "messages"
                  ? [{ indexDescriptor: "by_channel", fields: ["channel"] }]
                  : [],
              searchIndexes: [],
              documentType: { type: "object", value: SHAPES[table.name] },
            })),
            indexes: [{ table: "messages", name: "by_channel", fields: ["channel"] }],
          };
        case "convex_studio_data_infer_schema":
          return "defineTable({ value: v.number(), label: v.string() })";
        case "convex_studio_functions_list":
          return {
            components: [],
            modules: MODULES,
            httpRoutes: [
              { method: "POST", path: "/stripe/webhook", componentPath: "" },
              { method: "GET", path: "/health", componentPath: "" },
            ],
            siteUrl: "https://happy-otter-123.convex.site",
            truncated: false,
          };
        case "convex_studio_functions_detail":
          return {
            args: null,
            source:
              'export const list = query({\n  args: { channel: v.id("channels") },\n  handler: async (ctx, args) => {\n    return await ctx.db\n      .query("messages")\n      .withIndex("by_channel", (q) => q.eq("channel", args.channel))\n      .order("desc")\n      .take(50);\n  },\n});\n',
            sourceTruncated: false,
          };
        case "convex_studio_functions_stats": {
          const data = buckets(String(args.identifier).length);
          return {
            windowMinutes: 60,
            invocations: data.reduce((sum, bucket) => sum + bucket.invocations, 0),
            errors: data.reduce((sum, bucket) => sum + bucket.errors, 0),
            p50Ms: 18,
            p95Ms: 142,
            buckets: data,
          };
        }
        case "convex_studio_functions_run":
          return {
            success: true,
            value: documents("messages", 3),
            errorMessage: null,
            errorData: null,
            logLines: ["[LOG] 'geladen' 3"],
            logLinesTruncated: false,
            durationMs: 23,
          };
        case "convex_studio_logs_fetch": {
          logCalls++;
          if (logCalls > 1) await new Promise((resolve) => setTimeout(resolve, 2000));
          return {
            entries: logCalls === 1 ? Array.from({ length: 120 }, (_, i) => logEntry(119 - i)) : [],
            newCursor: NOW + logCalls,
            timedOut: logCalls > 1,
            dropped: 0,
          };
        }
        case "convex_studio_files_list":
          return {
            files: Array.from({ length: 14 }, (_, i) => ({
              id: id(200 + i),
              creationTime: NOW - i * 90 * MINUTE,
              size: 12_000 + i * 48_300,
              contentType: ["image/png", "application/pdf", "image/jpeg", "text/csv"][i % 4],
              sha256: id(400 + i),
              url: null,
            })),
            cursor: null,
            hasMore: false,
          };
        case "convex_studio_files_count":
          return 14;
        case "convex_studio_schedules_jobs":
          return {
            jobs: Array.from({ length: 6 }, (_, i) => ({
              id: id(600 + i),
              udfPath: "users.js:syncProfile",
              function: "users.js:syncProfile",
              state: i === 5 ? "inProgress" : "pending",
              error: null,
              scheduledMs: NOW + (i + 1) * 9 * MINUTE,
              originalScheduledMs: NOW + (i + 1) * 9 * MINUTE,
              completedMs: null,
              createdMs: NOW - 12 * MINUTE,
              argsId: null,
              args: { userId: id(i) },
              attempts: null,
            })),
            cursor: null,
            hasMore: false,
          };
        case "convex_studio_schedules_functions":
          return [
            {
              udfPath: "users.js:syncProfile",
              function: "users.js:syncProfile",
              kind: "action",
              internal: true,
            },
            {
              udfPath: "messages.js:send",
              function: "messages.js:send",
              kind: "mutation",
              internal: false,
            },
          ];
        case "convex_studio_schedules_crons":
          return ["cleanupPresence", "digest"].map((name, i) => ({
            name,
            udfPath: `crons.js:${name}`,
            function: `crons.js:${name}`,
            schedule: i
              ? { type: "cron", cronExpr: "0 7 * * *" }
              : { type: "interval", seconds: 300 },
            description: i ? "0 7 * * *" : "alle 5 Minuten",
            args: {},
            nextRunMs: NOW + (i + 1) * 4 * MINUTE,
            lastRun: cronRun(name, i * 2),
          }));
        case "convex_studio_schedules_cron_runs":
          return Array.from({ length: 8 }, (_, i) => cronRun(String(args.name), i));
        case "convex_studio_settings_info":
          return {
            url: "https://happy-otter-123.convex.cloud",
            siteUrl: "https://happy-otter-123.convex.site",
            cloudUrl: "https://happy-otter-123.convex.cloud",
            state: "running",
            version: "1.31.2",
            nodeVersion: "22",
            instanceName: "happy-otter-123",
            kind: "prod",
            authProviders: [{ domain: "https://acme.clerk.accounts.dev", applicationID: "convex" }],
            components: [],
            errors: [],
          };
        case "convex_studio_settings_stats":
          return {
            tableCount: TABLES.length,
            documentCount: TABLES.reduce((sum, table) => sum + table.documents, 0),
            functionCount: FUNCTIONS.length,
            httpRouteCount: 2,
            fileCount: 14,
            scheduledPending: 6,
            scheduledHasMore: false,
            cronCount: 2,
            errors: [],
          };
        case "convex_studio_settings_recent_errors":
          return [4, 12, 20, 13, 21, 22, 31].map((i) => {
            const entry = logEntry(i);
            return {
              identifier: entry.identifier,
              udfType: entry.udfType,
              timestamp: entry.timestampMs / 1000,
              message:
                "Uncaught Error: Nicht berechtigt, in diesen Kanal zu schreiben\n    at handler (../convex/messages.ts:18:4)",
              requestId: entry.requestId,
            };
          });
        case "convex_studio_settings_export_status":
          return null;
        case "plugin:event|listen":
          return Math.floor(Math.random() * 1e6);
        case "plugin:app|version":
          return "0.42.0";
        case "plugin:app|name":
          return "l8db";
        case "plugin:os|platform":
          return "linux";
        case "supabase_is_connected":
          return false;
        case "list_databases":
        case "list_schemas":
        case "list_tables":
        case "supabase_projects":
        case "appwrite_profiles":
        case "pocketbase_profiles":
        case "firebase_profiles":
          return [];
        default:
          return null;
      }
    };
    Object.assign(window, {
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
      __TAURI_INTERNALS__: {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { windowLabel: "main", label: "main" },
        },
        transformCallback: (callback: unknown) => {
          const key = Math.floor(Math.random() * 1e9);
          Object.assign(window, { [`_${key}`]: callback });
          return key;
        },
        unregisterCallback: (key: number) => {
          delete (window as unknown as Record<string, unknown>)[`_${key}`];
        },
        convertFileSrc: (path: string) => path,
        invoke: (command: string, args: Record<string, unknown> | undefined) =>
          invoke(command, args ?? {}),
      },
    });
    localStorage.setItem(
      "l8db.settings",
      JSON.stringify({ state: { tourFinished: true, onboardingDone: true }, version: 1 }),
    );
  });
  await page.route("**/blog/feed.json", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: 1, generatedAt: "2026-10-25T00:00:00Z", items: [] }),
    }),
  );
}

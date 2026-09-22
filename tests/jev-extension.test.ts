import { describe, expect, test } from "bun:test";
import { activate, jevRequest, validatePlanSummary } from "../extention/src/extension";
import type { ExtensionContext, Json, L8dbApi } from "../packages/extension-api/src";
import type { ExplainNode } from "../src/lib/db";
import { summarizeExplainPlan } from "../src/lib/extensions/plan-summary";

const plan = {
  "Node Type": "Seq Scan",
  "Relation Name": "secret_customers",
  Filter: "email = 'private@example.com'",
  "Startup Cost": 0,
  "Total Cost": 200,
  "Plan Rows": 100,
  "Plan Width": 20,
  "Actual Total Time": 43,
  "Actual Rows": 5000,
  "Shared Read Blocks": 100,
  Plans: [
    {
      "Node Type": "Sort",
      "Sort Key": ["private_column"],
      "Startup Cost": 0,
      "Total Cost": 100,
      "Plan Rows": 100,
      "Plan Width": 20,
    },
  ],
} satisfies ExplainNode;

function harness(approve: boolean) {
  const handlers = new Map<string, (payload?: Json) => unknown>();
  const secrets = new Map<string, string>();
  const requests: { url: string; options: unknown }[] = [];
  const messages: string[] = [];
  const api = {
    commands: {
      registerCommand(id: string, handler: (payload?: Json) => unknown) {
        handlers.set(id, handler);
        return { dispose: () => handlers.delete(id) };
      },
    },
    secrets: {
      get: async (key: string) => secrets.get(key) ?? null,
      set: async (key: string, value: string) => {
        secrets.set(key, value);
      },
      delete: async (key: string) => {
        secrets.delete(key);
      },
    },
    window: {
      showInputBox: async () => "test-byok-key",
      showInformationMessage: async (message: string) => {
        messages.push(message);
        return approve && message.startsWith("Diese Anfrage") ? "An TypeSafe senden" : undefined;
      },
    },
    network: {
      fetch: async (url: string, options: unknown) => {
        requests.push({ url, options });
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            answers: { bottleneck: { type: "choice", choice: "scan", confidence: 0.82 } },
          }),
        };
      },
    },
    notifications: { showInfo: async () => undefined },
  } as unknown as L8dbApi;
  activate({ subscriptions: [] } as unknown as ExtensionContext, api);
  return { handlers, secrets, requests, messages };
}

describe("Jev-Extension", () => {
  test("Planmerkmale enthalten keine SQL-Texte, Namen oder Werte", () => {
    const summary = summarizeExplainPlan(plan, true);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("secret_customers");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("private_column");
    expect(summary.nodes.map((node) => node.kind)).toEqual(["sequential_scan", "sort"]);
    expect(summary.nodes[0].estimateMismatch).toBe("medium");
    expect(validatePlanSummary(summary)).toEqual(summary);
    expect(JSON.stringify(validatePlanSummary({ ...summary, sql: "SELECT secret" }))).not.toContain(
      "SELECT secret",
    );
  });

  test("fragt Zustimmung ab, sendet nur geprüfte Merkmale und unterstützt BYOK-Löschung", async () => {
    const { handlers, secrets, requests, messages } = harness(true);
    const summary = summarizeExplainPlan(plan, true) as unknown as Json;
    await handlers.get("jev.analyze")?.(summary);
    expect(secrets.get("apiKey")).toBe("test-byok-key");
    expect(requests).toHaveLength(1);
    const { url, options } = requests[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    const body = JSON.stringify(JSON.parse((options as { body: string }).body));
    expect(body).not.toContain("secret_customers");
    expect(body).not.toContain("private@example.com");
    expect(body).toContain("jev-latest");
    expect(messages[0]).toContain("sequential_scan");
    expect(messages.at(-1)).toContain("Breiter Tabellenscan");
    await handlers.get("jev.removeKey")?.();
    expect(secrets.has("apiKey")).toBe(false);
  });

  test("Abbruch und ungültige Eingaben lösen keinen API-Aufruf aus", async () => {
    const { handlers, requests } = harness(false);
    await handlers.get("jev.analyze")?.(summarizeExplainPlan(plan, false) as unknown as Json);
    expect(requests).toHaveLength(0);
    await expect(
      Promise.resolve(handlers.get("jev.analyze")?.({ version: 1, nodes: [{ sql: "secret" }] })),
    ).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });

  test("zeigt auch große Pläne vollständig zur Freigabe an", async () => {
    const manyNodes = {
      ...plan,
      Plans: Array.from({ length: 23 }, () => ({ "Node Type": "Seq Scan", "Plan Rows": 100 })),
    } satisfies ExplainNode;
    const summary = summarizeExplainPlan(manyNodes, true);
    expect(summary.nodes).toHaveLength(24);
    expect(summary.truncated).toBe(false);
    const { handlers, requests, messages } = harness(true);
    await handlers.get("jev.analyze")?.(summary as unknown as Json);
    expect(messages[0].length).toBeLessThanOrEqual(16384);
    expect(messages[0]).toContain(JSON.stringify(jevRequest(summary as unknown as Json), null, 2));
    expect(requests).toHaveLength(1);
  });
});

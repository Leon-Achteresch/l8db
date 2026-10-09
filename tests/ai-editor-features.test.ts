import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const invokeCalls: { command: string; args: Record<string, unknown> }[] = [];
type Handler = (args: Record<string, unknown>) => unknown;
const handlers = new Map<string, Handler>();

class FakeChannel<T> {
  onmessage: (message: T) => void = () => {};
}

mock.module("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  transformCallback: () => 1,
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    invokeCalls.push({ command, args });
    const handler = handlers.get(command);
    if (!handler) return null;
    return handler(args);
  },
}));

function monacoStub(): unknown {
  return new Proxy(class {}, {
    get: (_target, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : monacoStub(),
    apply: () => monacoStub(),
    construct: () => monacoStub() as object,
  });
}

mock.module("@/lib/monaco", () => ({
  monaco: monacoStub(),
  activeConnectionKind: () => null,
  activeSqlDialect: () => undefined,
  addSqlFormatAction: () => {},
  isSqlFormattingAvailable: () => false,
  attachPlsqlLint: () => {},
  showQueryAssessment: () => {},
  showSqlError: () => {},
  overflowWidgetsDomNode: () => null,
}));

const { MAX_GLOBAL_CHARS, useEditorCheckpoints } = await import("@/lib/ai/editor/checkpoints");
const {
  EditorAiUnavailable,
  editorAiProfile,
  editorAiSupported,
  inlineSupported,
  routedProfile,
  runEditorAi,
} = await import("@/lib/ai/editor/client");
const { editRequest, forgetEditorKnowledge, inlineRequest, summaryRequest } = await import(
  "@/lib/ai/editor/context"
);
const { cleanCompletion, fromCache, shouldRequest, singleLineIfNeeded } = await import(
  "@/lib/ai/editor/ghost-text"
);
const { validateEdit } = await import("@/lib/ai/editor/inline-edit");
const { percentile, summarizeEditorAiStats, useEditorAiMetrics } = await import(
  "@/lib/ai/editor/metrics"
);
const { lensOffsets, MAX_LENS_STATEMENTS } = await import("@/lib/ai/editor/monaco-codelens");
const { dialectName, fnv1a, joinSections, systemPrompt } = await import("@/lib/ai/editor/prompts");
const { findRenameProposal, identifierAt, identifiers, isRenameCandidate } = await import(
  "@/lib/ai/editor/rename"
);
const { useEditorAiSettings } = await import("@/lib/ai/editor/settings");
const { expandToLines, insertionAfter, resolveTarget, statementBounds } = await import(
  "@/lib/ai/editor/targets"
);
const { useProvidersStore } = await import("@/lib/providers");

import type { EditorAiEnvironment } from "@/lib/ai/editor/context";
import type { EditorAiStats } from "@/lib/ai/editor/metrics";
import type { SavedConnection } from "@/lib/connections";
import type { AiProfile } from "@/lib/db/ai";
import type { ColumnInfo, TableInfo } from "@/lib/db/types";

useProvidersStore.setState({ loaded: true });

function profile(patch: Partial<AiProfile> = {}): AiProfile {
  return {
    id: "p1",
    provider: "anthropic",
    binary: "",
    home: "",
    endpoint: "",
    model: "claude-big",
    effort: "high",
    mode: "",
    approval: "ask",
    ...patch,
  };
}

function connection(patch: Partial<SavedConnection> = {}): SavedConnection {
  return {
    id: "conn-1",
    name: "Local",
    kind: "postgres",
    connectionString: "postgres://app@localhost:5432/app",
    sslMode: "prefer",
    ...patch,
  };
}

const TABLES: TableInfo[] = [
  { schema: "public", name: "orders" },
  { schema: "public", name: "customers" },
  { schema: "public", name: "products" },
];
const VIEWS: TableInfo[] = [{ schema: "public", name: "order_totals" }];
const COLUMNS: ColumnInfo[] = [
  { schema: "public", table: "orders", name: "id", data_type: "integer" },
  { schema: "public", table: "orders", name: "customer_id", data_type: "integer" },
  { schema: "public", table: "orders", name: "total", data_type: "numeric" },
  { schema: "public", table: "customers", name: "id", data_type: "integer" },
  { schema: "public", table: "customers", name: "email", data_type: "text" },
  { schema: "public", table: "products", name: "id", data_type: "integer" },
];

function env(patch: Partial<EditorAiEnvironment> = {}): EditorAiEnvironment {
  return {
    registry: {
      schemas: ["public"],
      tables: TABLES,
      views: VIEWS,
      columns: COLUMNS,
      functions: [],
      procedures: [],
    },
    connection: connection(),
    database: "app",
    defaultSchema: "public",
    queryClient: null,
    ...patch,
  };
}

beforeEach(() => {
  invokeCalls.length = 0;
  handlers.clear();
  forgetEditorKnowledge();
  useEditorAiSettings.getState().reset();
  useEditorAiMetrics.getState().reset();
});

describe("ghost text", () => {
  test("strips fences, cursor markers and echoed line prefix", () => {
    expect(cleanCompletion("```sql\nselect id from orders\n```", "", "")).toBe(
      "select id from orders",
    );
    expect(cleanCompletion("id<CURSOR>, total", "select ", "")).toBe("id, total");
    expect(cleanCompletion("select id from orders", "  select ", "")).toBe("id from orders");
    expect(cleanCompletion("\r\nfrom orders\r\nwhere id = 1", "select *", "")).toBe(
      "\nfrom orders\nwhere id = 1",
    );
  });

  test("keeps leading whitespace that separates the completion from the prefix", () => {
    expect(cleanCompletion(" FROM t", "SELECT id", "")).toBe(" FROM t");
    expect(cleanCompletion("  where a = 1", "select * from t", "")).toBe("  where a = 1");
  });

  test("strips a repeated partial word case-insensitively", () => {
    expect(cleanCompletion("id, col_1", "SELECT i", "")).toBe("d, col_1");
    expect(cleanCompletion("ORDERS o", "select * from ord", "")).toBe("ERS o");
  });

  test("drops leading spaces and tabs after whitespace or on an empty line", () => {
    expect(cleanCompletion(" id", "SELECT ", "")).toBe("id");
    expect(cleanCompletion("\t\tselect 1", "", "")).toBe("select 1");
    expect(cleanCompletion("\tid", "SELECT\t", "")).toBe("id");
  });

  test("removes overlap with the text after the cursor", () => {
    expect(cleanCompletion("count(*)", "select ", ")")).toBe("count(*");
    expect(cleanCompletion("id from orders;", "select ", "; -- tail")).toBe("id from orders");
    expect(cleanCompletion("id", "select ", "\n  from t")).toBe("id");
  });

  test("caps completions at 8 lines and returns empty for whitespace", () => {
    const raw = Array.from({ length: 20 }, (_, index) => `line_${index}`).join("\n");
    expect(cleanCompletion(raw, "", "").split("\n")).toHaveLength(8);
    expect(cleanCompletion("   \n\n", "select ", "")).toBe("");
    expect(cleanCompletion("<CURSOR>", "select ", "")).toBe("");
  });

  test("fromCache continues a cached completion while the user types it", () => {
    const entry = { key: "k", prefix: "select ", text: "id, total from orders" };
    expect(fromCache(entry, "k", "select ")).toBe("id, total from orders");
    expect(fromCache(entry, "k", "select id, ")).toBe("total from orders");
    expect(fromCache(entry, "k", "select id, total from orders")).toBeNull();
    expect(fromCache(entry, "k", "select x")).toBeNull();
    expect(fromCache(entry, "other", "select id")).toBeNull();
    expect(fromCache(entry, "k", "selec")).toBeNull();
    expect(fromCache(null, "k", "select ")).toBeNull();
  });

  test("shouldRequest skips strings, comments, mid-word and empty documents", () => {
    expect(shouldRequest("select ", "", "select ")).toBe(true);
    expect(shouldRequest("select ", ")", "select ()")).toBe(true);
    expect(shouldRequest("s", "", "s")).toBe(false);
    expect(shouldRequest("select ", "id", "select id")).toBe(false);
    expect(shouldRequest("select ", "$1", "select $1")).toBe(false);
    expect(shouldRequest("where a = 'ab", "", "where a = 'ab")).toBe(false);
    expect(shouldRequest("where a = 'it''s' and ", "", "x where")).toBe(true);
    expect(shouldRequest("select 1 -- note ", "", "select 1")).toBe(false);
  });

  test("singleLineIfNeeded keeps only the first line when text follows the cursor", () => {
    expect(singleLineIfNeeded("a\nb", "")).toBe("a\nb");
    expect(singleLineIfNeeded("a\nb", "   ")).toBe("a\nb");
    expect(singleLineIfNeeded("a\nb", ") x")).toBe("a");
  });
});

describe("rename", () => {
  test("identifierAt finds the word around the cursor", () => {
    const text = "select order_id, $x from t1";
    expect(identifierAt(text, 9)).toEqual({ start: 7, end: 15, word: "order_id" });
    expect(identifierAt(text, 7)).toEqual({ start: 7, end: 15, word: "order_id" });
    expect(identifierAt(text, 15)).toEqual({ start: 7, end: 15, word: "order_id" });
    expect(identifierAt(text, 16)).toBeNull();
    expect(identifierAt("select 123abc", 10)).toBeNull();
    expect(identifierAt("", 0)).toBeNull();
  });

  test("identifiers skips strings and comments and unquotes quoted names", () => {
    const text = `select a, 'b''c' as "Quoted Name", [br], \`bt\` -- d e\n/* f g */ from t_1 where x$1 = 2`;
    expect(identifiers(text).map((span) => span.word)).toEqual([
      "select",
      "a",
      "as",
      "Quoted Name",
      "br",
      "bt",
      "from",
      "t_1",
      "where",
      "x$1",
    ]);
    for (const span of identifiers(text)) {
      expect(text.slice(span.start, span.end)).toBe(span.word);
    }
  });

  test("identifiers respects a scope that starts inside a word", () => {
    const text = "customer_id, customer";
    expect(identifiers(text, 3, text.length).map((span) => span.word)).toEqual(["customer"]);
    expect(identifiers(text, 0, 5).map((span) => span.word)).toEqual(["custo"]);
  });

  test("isRenameCandidate rejects keywords, case changes and non identifiers", () => {
    expect(isRenameCandidate("total", "amount")).toBe(true);
    expect(isRenameCandidate("total", "total")).toBe(false);
    expect(isRenameCandidate("total", "TOTAL")).toBe(false);
    expect(isRenameCandidate("select", "pick")).toBe(false);
    expect(isRenameCandidate("total", "from")).toBe(false);
    expect(isRenameCandidate("1x", "y")).toBe(false);
    expect(isRenameCandidate("x", "")).toBe(false);
  });

  test("findRenameProposal returns other occurrences in scope, excluding the edit", () => {
    const sql =
      "select o.total, sum(o.TOTAL) from orders o where 'total' <> '' and o.total > 0 -- total\n;select total from x";
    const scopeEnd = sql.indexOf(";select");
    const first = sql.indexOf("total");
    const proposal = findRenameProposal(
      sql,
      { start: 0, end: scopeEnd },
      { start: first, end: first + 5 },
      "total",
      "amount",
    );
    expect(proposal?.oldName).toBe("total");
    expect(proposal?.newName).toBe("amount");
    expect(proposal?.ranges.map((range) => sql.slice(range.start, range.end))).toEqual([
      "TOTAL",
      "total",
    ]);
    expect(proposal?.ranges.every((range) => range.end <= scopeEnd)).toBe(true);
    expect(
      findRenameProposal(sql, { start: 0, end: scopeEnd }, { start: 0, end: 0 }, "total", "a", 1)
        ?.ranges,
    ).toHaveLength(1);
    expect(
      findRenameProposal(sql, { start: 0, end: scopeEnd }, { start: 0, end: 0 }, "nope", "a"),
    ).toBeNull();
    expect(
      findRenameProposal(sql, { start: 0, end: scopeEnd }, { start: 0, end: 0 }, "total", "from"),
    ).toBeNull();
  });
});

describe("targets", () => {
  const sql = "-- head\nselect 1;\n\nselect *\nfrom t\nwhere a = 1;\n";

  test("expandToLines widens to full lines and ignores a trailing newline", () => {
    expect(expandToLines(sql, 10, 12)).toEqual({ start: 8, end: 17 });
    expect(expandToLines(sql, 19, 28)).toEqual({ start: 19, end: 27 });
    expect(expandToLines(sql, 21, 30)).toEqual({ start: 19, end: 34 });
    expect(expandToLines(sql, 0, 0)).toEqual({ start: 0, end: 7 });
    expect(expandToLines("abc", 1, 3)).toEqual({ start: 0, end: 3 });
  });

  test("expandToLines and generate targets at offset 0 stay on the first line", () => {
    expect(expandToLines("\nselect 1", 0, 0)).toEqual({ start: 0, end: 0 });
    expect(resolveTarget("\nselect 1", 0, 0)).toEqual({ start: 0, end: 0, mode: "generate" });
  });

  test("statementBounds finds the statement or the one directly before the cursor", () => {
    expect(statementBounds(sql, 12)).toEqual({ start: 0, end: 17 });
    expect(statementBounds(sql, 18)).toEqual({ start: 0, end: 17 });
    expect(statementBounds(sql, 30)).toEqual({ start: 19, end: 47 });
    expect(statementBounds(sql, sql.length)).toEqual({ start: 19, end: 47 });
    expect(statementBounds("   ", 1)).toBeNull();
    expect(statementBounds("select 1; garbage", 17)).toEqual({ start: 10, end: 17 });
  });

  test("resolveTarget picks selection, comment, generate and statement modes", () => {
    expect(resolveTarget(sql, 21, 30)).toEqual({ start: 19, end: 34, mode: "selection" });
    expect(resolveTarget(sql, 3, 3)).toEqual({
      start: 8,
      end: 8,
      mode: "comment",
      instruction: "head",
    });
    expect(resolveTarget(sql, 18, 18)).toEqual({ start: 18, end: 18, mode: "generate" });
    expect(resolveTarget(sql, 30, 30)).toEqual({ start: 19, end: 47, mode: "statement" });
    expect(resolveTarget(sql, 17, 18)).toEqual({ start: 0, end: 17, mode: "statement" });
    const comments = "-- list all\n-- active users\n";
    expect(resolveTarget(comments, 14, 14)).toEqual({
      start: comments.length,
      end: comments.length,
      mode: "comment",
      instruction: "list all active users",
    });
  });

  test("insertionAfter returns the start of the next line", () => {
    expect(insertionAfter(sql, 12)).toBe(18);
    expect(insertionAfter("select 1", 3)).toBe(8);
  });
});

describe("prompts", () => {
  test("dialectName maps known kinds and falls back to ANSI SQL", () => {
    expect(dialectName("postgres")).toBe("PostgreSQL");
    expect(dialectName("mssql")).toContain("T-SQL");
    expect(dialectName("unknown")).toBe("ANSI SQL");
    expect(dialectName(null)).toBe("ANSI SQL");
    expect(dialectName(undefined)).toBe("ANSI SQL");
  });

  test("joinSections drops empty and falsy sections", () => {
    expect(joinSections(["a", "", "  ", null, undefined, false, 0, "b"])).toBe("a\n\nb");
    expect(joinSections([])).toBe("");
  });

  test("systemPrompt returns distinct stable prompts", () => {
    expect(systemPrompt("inline")).toContain("<CURSOR>");
    expect(systemPrompt("edit")).toContain("SEARCH/REPLACE");
    expect(systemPrompt("summary")).toContain("bullet");
    expect(systemPrompt("edit")).toBe(systemPrompt("edit"));
  });

  test("fnv1a is stable, fixed width and well distributed", () => {
    expect(fnv1a("")).toBe(fnv1a(""));
    expect(fnv1a("select 1")).toBe(fnv1a("select 1"));
    expect(fnv1a("select 1")).not.toBe(fnv1a("select 2"));
    expect(fnv1a("abc")).toMatch(/^[0-9a-f]{16}$/);
    const seen = new Set<string>();
    const buckets = new Array(16).fill(0);
    for (let index = 0; index < 50_000; index++) {
      const hash = fnv1a(`prefix-${index}`);
      seen.add(hash);
      buckets[Number.parseInt(hash[15], 16)]++;
    }
    expect(seen.size).toBe(50_000);
    for (const count of buckets) {
      expect(count).toBeGreaterThan(50_000 / 16 / 1.3);
      expect(count).toBeLessThan((50_000 / 16) * 1.3);
    }
  });
});

describe("client", () => {
  test("support checks distinguish API, editor-capable CLI and other CLI providers", () => {
    expect(editorAiSupported(profile())).toBe(true);
    expect(editorAiSupported(profile({ provider: "claude" }))).toBe(true);
    expect(editorAiSupported(profile({ provider: "codex" }))).toBe(true);
    expect(editorAiSupported(profile({ provider: "gemini-cli" }))).toBe(false);
    expect(inlineSupported(profile())).toBe(true);
    expect(inlineSupported(profile({ provider: "ollama" }))).toBe(true);
    expect(inlineSupported(profile({ provider: "claude" }))).toBe(false);
  });

  test("routedProfile sends fast actions to the fast model without effort or approval", () => {
    useEditorAiSettings.getState().update({ fastModel: "  claude-fast " });
    const editor = () => profile({ id: editorAiProfile().id });
    expect(routedProfile(profile({ id: "chat-only" }), "summary").model).toBe("claude-big");
    const fast = routedProfile(editor(), "inline");
    expect(fast.model).toBe("claude-fast");
    expect(fast.effort).toBe("");
    expect(fast.approval).toBe("");
    for (const action of ["comment", "testdata", "summary"] as const)
      expect(routedProfile(editor(), action).model).toBe("claude-fast");
    const slow = routedProfile(editor(), "optimize");
    expect(slow.model).toBe("claude-big");
    expect(slow.effort).toBe("high");
    expect(slow.approval).toBe("");
    useEditorAiSettings.getState().update({ fastModel: "   " });
    expect(routedProfile(editor(), "inline").model).toBe("claude-big");
  });

  test("runEditorAi streams, records metrics and passes a cache key for OpenAI", async () => {
    let request: Record<string, unknown> = {};
    handlers.set("ai_complete", (args) => {
      request = args.request as Record<string, unknown>;
      const events = args.events as FakeChannel<{ kind: string; data: Record<string, unknown> }>;
      events.onmessage({ kind: "text", data: { delta: "sel" } });
      events.onmessage({ kind: "text", data: { delta: "ect 1" } });
      events.onmessage({
        kind: "usage",
        data: { usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 80 } },
      });
      return { text: "", truncated: false, model: "gpt-x" };
    });
    const deltas: string[] = [];
    const response = await runEditorAi({
      action: "edit",
      cached: "CACHED PREFIX",
      messages: [{ role: "user", text: "hi" }],
      maxTokens: 50,
      profile: profile({ provider: "openai", model: "gpt-x" }),
      onDelta: (text) => deltas.push(text),
    });
    expect(response.text).toBe("select 1");
    expect(response.model).toBe("gpt-x");
    expect(deltas).toEqual(["sel", "select 1"]);
    expect(request.cacheKey).toBe(fnv1a("CACHED PREFIX"));
    expect(request.cached).toBe("CACHED PREFIX");
    expect(request.system).toBe("");
    const stats = useEditorAiMetrics.getState().actions.edit;
    expect(stats?.requests).toBe(1);
    expect(stats?.latencies).toHaveLength(1);
    expect(stats?.errors).toBe(0);
    expect(invokeCalls.map((call) => call.command)).toEqual(["ai_complete"]);
  });

  test("runEditorAi omits the cache key for non-OpenAI providers", async () => {
    let request: Record<string, unknown> = {};
    handlers.set("ai_complete", (args) => {
      request = args.request as Record<string, unknown>;
      return { text: "x", truncated: false, model: "m" };
    });
    await runEditorAi({
      action: "inline",
      cached: "c",
      messages: [],
      maxTokens: 1,
      profile: profile(),
    });
    expect(request.cacheKey).toBeUndefined();
  });

  test("aborting cancels the backend run and counts a cancellation", async () => {
    const controller = new AbortController();
    let release: (value: unknown) => void = () => {};
    handlers.set("ai_complete", () => {
      queueMicrotask(() => controller.abort());
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    handlers.set("ai_complete_cancel", () => {
      release({ text: "late", truncated: false, model: "m" });
      return null;
    });
    const error = await runEditorAi({
      action: "fix",
      cached: "c",
      messages: [],
      maxTokens: 10,
      signal: controller.signal,
      profile: profile(),
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    const run = invokeCalls.find((call) => call.command === "ai_complete");
    const cancel = invokeCalls.find((call) => call.command === "ai_complete_cancel");
    expect(cancel?.args.runId).toBe((run?.args.request as { runId: string } | undefined)?.runId);
    expect(cancel?.args.runId).toBeString();
    const stats = useEditorAiMetrics.getState().actions.fix;
    expect(stats?.cancelled).toBe(1);
    expect(stats?.errors).toBe(0);
    expect(stats?.requests ?? 0).toBe(0);
  });

  test("an already aborted signal never reaches the backend", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runEditorAi({
        action: "fix",
        cached: "",
        messages: [],
        maxTokens: 1,
        signal: controller.signal,
        profile: profile(),
      }),
    ).rejects.toThrow("Abgebrochen");
    expect(invokeCalls).toHaveLength(0);
  });

  test("backend errors are counted and rethrown", async () => {
    handlers.set("ai_complete", () => {
      throw "rate limited";
    });
    await expect(
      runEditorAi({ action: "cte", cached: "", messages: [], maxTokens: 1, profile: profile() }),
    ).rejects.toThrow("rate limited");
    expect(useEditorAiMetrics.getState().actions.cte?.errors).toBe(1);
  });

  test("unsupported CLI providers throw EditorAiUnavailable without invoking", async () => {
    const error = await runEditorAi({
      action: "edit",
      cached: "",
      messages: [],
      maxTokens: 1,
      profile: profile({ provider: "copilot" }),
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(EditorAiUnavailable);
    expect(invokeCalls).toHaveLength(0);
  });
});

describe("metrics", () => {
  test("record, fail and outcome accumulate per action", () => {
    const metrics = useEditorAiMetrics.getState();
    metrics.record("inline", {
      input: 100,
      output: 10,
      cached: 60,
      written: 5,
      cost: 0.5,
      latencyMs: 120.4,
    });
    metrics.record("inline", {
      input: 50,
      output: 5,
      cached: 0,
      written: 0,
      cost: null,
      latencyMs: 80.6,
    });
    metrics.fail("inline", true);
    metrics.fail("inline", false);
    metrics.outcome("inline", "accepted");
    metrics.outcome("inline", "partial");
    metrics.outcome("inline", "rejected");
    metrics.retry("inline");
    metrics.localHit("inline");
    const stats = useEditorAiMetrics.getState().actions.inline as EditorAiStats;
    expect(stats).toMatchObject({
      requests: 2,
      input: 150,
      output: 15,
      cached: 60,
      written: 5,
      cost: 0.5,
      latencies: [120, 81],
      cancelled: 1,
      errors: 1,
      accepted: 1,
      partial: 1,
      rejected: 1,
      retries: 1,
      cacheHits: 1,
    });
    expect(useEditorAiMetrics.getState().actions.edit).toBeUndefined();
    const summary = summarizeEditorAiStats(stats);
    expect(summary.tokensPerRequest).toBe(83);
    expect(summary.cacheRate).toBeCloseTo(0.4);
    expect(summary.acceptRate).toBeCloseTo(0.5);
  });

  test("latencies keep only the last 50 samples", () => {
    const metrics = useEditorAiMetrics.getState();
    for (let index = 0; index < 80; index++)
      metrics.record("edit", {
        input: 1,
        output: 1,
        cached: 0,
        written: 0,
        cost: 0,
        latencyMs: index,
      });
    const stats = useEditorAiMetrics.getState().actions.edit as EditorAiStats;
    expect(stats.latencies).toHaveLength(50);
    expect(stats.latencies[0]).toBe(30);
    expect(stats.requests).toBe(80);
  });

  test("percentile uses the nearest rank", () => {
    const twenty = Array.from({ length: 20 }, (_, index) => 20 - index);
    expect(percentile(twenty, 0.95)).toBe(19);
    expect(percentile(twenty, 0.5)).toBe(10);
    expect(percentile([7], 0.95)).toBe(7);
    expect(percentile([3, 1, 2], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBe(0);
    expect(
      percentile(
        Array.from({ length: 100 }, (_, index) => index + 1),
        0.95,
      ),
    ).toBe(95);
  });

  test("summaries of empty stats have no rates", () => {
    const empty = summarizeEditorAiStats({
      requests: 0,
      errors: 0,
      cancelled: 0,
      input: 0,
      output: 0,
      cached: 0,
      written: 0,
      cost: 0,
      latencyMs: 0,
      latencies: [],
      accepted: 0,
      rejected: 0,
      partial: 0,
      retries: 0,
      cacheHits: 0,
    });
    expect(empty).toEqual({
      tokensPerRequest: 0,
      cacheRate: 0,
      acceptRate: null,
      medianMs: 0,
      p95Ms: 0,
    });
  });
});

describe("checkpoints", () => {
  afterEach(() => {
    useEditorCheckpoints.setState({ byEditor: {} });
  });

  function totalChars(editorId: string) {
    return (useEditorCheckpoints.getState().byEditor[editorId] ?? []).reduce(
      (sum, entry) => sum + entry.before.length,
      0,
    );
  }

  test("keeps at most 20 checkpoints per editor, newest last", () => {
    const store = useEditorCheckpoints.getState();
    for (let index = 0; index < 25; index++)
      store.add("a", { label: `edit ${index}`, before: `b${index}` });
    store.add("b", { label: "other", before: "x" });
    const list = useEditorCheckpoints.getState().byEditor.a;
    expect(list).toHaveLength(20);
    expect(list[0].label).toBe("edit 5");
    expect(list.at(-1)?.label).toBe("edit 24");
    expect(useEditorCheckpoints.getState().byEditor.b).toHaveLength(1);
  });

  test("bounds the total characters per editor at 8M", () => {
    const store = useEditorCheckpoints.getState();
    const big = "x".repeat(1_500_000);
    for (let index = 0; index < 6; index++) store.add("a", { label: `${index}`, before: big });
    expect(totalChars("a")).toBeLessThanOrEqual(8_000_000);
    expect(useEditorCheckpoints.getState().byEditor.a.map((entry) => entry.label)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  test("bounds the total characters across all editors", () => {
    const store = useEditorCheckpoints.getState();
    const big = "x".repeat(3_000_000);
    for (let index = 0; index < 12; index++)
      store.add(`e${index}`, { label: `${index}`, before: big });
    const all = Object.values(useEditorCheckpoints.getState().byEditor).flat();
    expect(all.reduce((sum, entry) => sum + entry.before.length, 0)).toBeLessThanOrEqual(
      MAX_GLOBAL_CHARS,
    );
    expect(all.at(-1)?.label).toBe("11");
    expect(useEditorCheckpoints.getState().byEditor.e0).toBeUndefined();
  });

  test("clear removes only that editor", () => {
    const store = useEditorCheckpoints.getState();
    store.add("a", { label: "1", before: "" });
    store.add("b", { label: "2", before: "" });
    store.clear("a");
    expect(useEditorCheckpoints.getState().byEditor.a).toBeUndefined();
    expect(useEditorCheckpoints.getState().byEditor.b).toHaveLength(1);
  });
});

describe("request context", () => {
  function knowledge(rules = "Always alias tables.", notes = "Prod copy") {
    handlers.set("ai_knowledge_get", () => ({
      rules,
      notes,
      glossary: [{ term: "GMV", meaning: "gross merchandise value" }],
      tables: { "public.orders": { description: "One row per order", columns: {} } },
    }));
  }

  test("inline cached prefix is byte-identical across cursors and edits", async () => {
    knowledge();
    const sql = "select * from orders o join customers c on c.id = o.customer_id;\nselect ";
    const first = await inlineRequest(env(), sql, 14, []);
    const second = await inlineRequest(env(), sql, sql.length, ["- typed foo"]);
    expect(first.cached).toBe(second.cached);
    expect(first.messages[0].text).not.toBe(second.messages[0].text);
    expect(first.cached).toContain("Always alias tables.");
    expect(first.cached).not.toContain("Prod copy");
    expect(first.cached).toContain("Dialect: PostgreSQL. Default schema: public.");
    expect(first.messages[0].text).toContain("<CURSOR>");
    expect(first.messages[0].text).toContain("customer_id");
    expect(second.messages[0].text).toContain("Recent edits:\n- typed foo");
    expect(first.maxTokens).toBe(160);
    expect(first.stop).toEqual(["<CURSOR>", "\n\n\n"]);
    expect(invokeCalls.filter((call) => call.command === "ai_knowledge_get")).toHaveLength(1);
  });

  test("edit cached prefix is identical across targets and prompts, rules before hints", async () => {
    knowledge();
    const sql = "select id from orders;\nselect email from customers where id = 1;\n";
    const a = await editRequest(env(), {
      action: "edit",
      instruction: "add total",
      sql,
      start: 0,
      end: 21,
    });
    const b = await editRequest(env(), {
      action: "optimize",
      instruction: "faster please",
      sql,
      start: 23,
      end: sql.length - 1,
      earlier: ["first", "second"],
    });
    expect(a.cached).toBe(b.cached);
    const rules = a.cached.indexOf("Always alias tables.");
    const hints = a.cached.indexOf("Prod copy");
    expect(rules).toBeGreaterThan(0);
    expect(hints).toBeGreaterThan(rules);
    expect(a.cached).toContain('Term "GMV": gross merchandise value');
    expect(a.cached).toContain("Table public.orders: One row per order");
    expect(a.messages[0].text).toContain("TARGET (lines 1-1)");
    expect(a.messages[0].text).toContain("Task: add total");
    expect(b.messages[0].text).toContain("TARGET (lines 2-2)");
    expect(b.messages[0].text).toContain("Make TARGET faster");
    expect(b.messages[0].text).toContain("1. first\n2. second");
    expect(a.maxTokens).toBe(421);
    const empty = await editRequest(env(), {
      action: "edit",
      instruction: "",
      sql,
      start: 22,
      end: 22,
    });
    expect(empty.messages[0].text).toContain("TARGET is empty");
    expect(empty.messages[0].text).toContain("Task: Improve TARGET.");
  });

  test("edit requests cap rules, hints and output tokens", async () => {
    const longNotes = "n".repeat(10_000);
    knowledge("r".repeat(20_000), longNotes);
    const target = "select 1 ".repeat(1_000);
    const request = await editRequest(env(), {
      action: "edit",
      instruction: "x",
      sql: target,
      start: 0,
      end: target.length,
    });
    const rulesRun = /r+/.exec(request.cached.slice(request.cached.indexOf("rrrr")))?.[0] ?? "";
    expect(rulesRun.length).toBe(8_000);
    const notesRun = /n{100,}/.exec(request.cached)?.[0] ?? "";
    expect(notesRun.length).toBeLessThan(2_500);
    expect(request.maxTokens).toBe(4_000);
    const testdata = await editRequest(env(), {
      action: "testdata",
      instruction: "",
      sql: "x",
      start: 0,
      end: 1,
    });
    expect(testdata.maxTokens).toBe(3_000);
  });

  test("secrets are redacted from cursor windows, targets and extra context", async () => {
    knowledge("", "");
    const sql =
      "select dblink('postgres://admin:hunter2@db/prod', 'select 1'); -- password=topsecret\nselect ";
    const inline = await inlineRequest(env(), sql, sql.length, []);
    expect(inline.messages[0].text).not.toContain("hunter2");
    expect(inline.messages[0].text).not.toContain("topsecret");
    const edit = await editRequest(env(), {
      action: "fix",
      instruction: "fix",
      sql,
      start: 0,
      end: sql.indexOf("\n"),
      extra: "Error: auth failed for postgres://admin:hunter2@db/prod",
    });
    expect(edit.messages[0].text).not.toContain("hunter2");
    expect(edit.messages[0].text).not.toContain("topsecret");
  });

  test("knowledge failures degrade to no rules and are cached for the TTL", async () => {
    handlers.set("ai_knowledge_get", () => {
      throw new Error("no store");
    });
    const first = await inlineRequest(env(), "select ", 7, []);
    await inlineRequest(env(), "select ", 7, []);
    expect(first.cached).not.toContain("Rules the user set");
    expect(invokeCalls.filter((call) => call.command === "ai_knowledge_get")).toHaveLength(1);
    const offline = await inlineRequest(env({ connection: null }), "select ", 7, []);
    expect(offline.cached).toContain("Dialect: ANSI SQL.");
  });

  test("summaryRequest redacts and caps the transcript", () => {
    const messages = [
      { role: "user" as const, text: "connect with postgres://u:pw1234@h/db" },
      { role: "assistant" as const, text: "a".repeat(200_000) },
    ];
    const request = summaryRequest(messages);
    expect(request.cached).toBe(systemPrompt("summary"));
    expect(request.messages[0].text.length).toBe(120_000);
    expect(request.messages[0].text).toStartWith("User: connect with postgres://u:***@h/db");
    expect(request.messages[0].text).toContain("\n\nAssistant: aaa");
    expect(request.maxTokens).toBe(900);
  });
});

describe("validateEdit", () => {
  function explainSpy() {
    const calls: unknown[][] = [];
    const explain = async (...args: unknown[]) => {
      calls.push(args);
      return null as never;
    };
    return { calls, explain: explain as never };
  }

  test("explains the first read-only statement without a trailing semicolon", async () => {
    const spy = explainSpy();
    const result = await validateEdit(
      env(),
      "select 1",
      "select id from orders;\nselect 2;",
      spy.explain,
    );
    expect(result).toBe("");
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0][0]).toBe("postgres");
    expect(spy.calls[0][2]).toBe("select id from orders");
    expect(spy.calls[0][3]).toBe(false);
    expect(spy.calls[0][4]).toBe("app");
  });

  test("skips EXPLAIN for writes, bind parameters, more than 3 statements and disabled validation", async () => {
    const spy = explainSpy();
    const cases = [
      "update orders set total = 0 where id = 1",
      "select * from orders where id = $1",
      "select * from orders where id = :id",
      "select * from orders where id = ?",
      "with x as (delete from orders returning id) select * from x",
      "select 1; select 2; select 3; select 4;",
      "",
    ];
    for (const after of cases) expect(await validateEdit(env(), "", after, spy.explain)).toBe("");
    expect(spy.calls).toHaveLength(0);
    expect(await validateEdit(env(), "", "select 1; select 2; select 3;", spy.explain)).toBe("");
    expect(spy.calls).toHaveLength(1);
    useEditorAiSettings.getState().update({ validate: false });
    expect(await validateEdit(env(), "", "select 1", spy.explain)).toBe("");
    expect(await validateEdit(env({ connection: null }), "", "select 1", spy.explain)).toBe("");
    expect(spy.calls).toHaveLength(1);
  });

  test("reports EXPLAIN errors compactly", async () => {
    const failing = async () => {
      throw new Error('column "nope" does not exist');
    };
    const result = await validateEdit(env(), "", "select nope from orders", failing as never);
    expect(result).toContain('column "nope" does not exist');
  });

  test("reports new unknown tables but not ones that were already there", async () => {
    const spy = explainSpy();
    const result = await validateEdit(
      env(),
      "select * from legacy_stuff",
      "select * from legacy_stuff join ghost_table g on true join ghost_table h on true",
      spy.explain,
    );
    expect(result).toBe("Unknown tables: Unbekannte Tabelle: ghost_table");
    expect(spy.calls).toHaveLength(0);
  });

  test("existing views are not reported as unknown tables", async () => {
    const spy = explainSpy();
    const result = await validateEdit(env(), "select 1", "select * from order_totals", spy.explain);
    expect(result).toBe("");
    expect(spy.calls).toHaveLength(1);
  });
});

describe("lensOffsets", () => {
  test("points at the first code character of each statement", () => {
    const sql = "-- intro\nselect 1;\n  /* note */ select 2;\n\n;  select 3";
    const offsets = lensOffsets(sql);
    expect(offsets.map((offset) => sql.slice(offset, offset + 8))).toEqual([
      "select 1",
      "select 2",
      "select 3",
    ]);
  });

  test("skips comment-only statements and respects the limit", () => {
    expect(lensOffsets("-- only a comment\n/* and a block */")).toEqual([]);
    const many = "select 1;\n".repeat(MAX_LENS_STATEMENTS + 50);
    expect(lensOffsets(many)).toHaveLength(MAX_LENS_STATEMENTS);
    expect(lensOffsets(many, undefined, 3)).toEqual([0, 10, 20]);
  });
});

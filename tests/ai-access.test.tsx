import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const invokeCalls: string[] = [];

class FakeChannel<T> {
  onmessage: (message: T) => void = () => {};
}

mock.module("@tauri-apps/api/core", () => ({
  Channel: FakeChannel,
  transformCallback: () => 1,
  invoke: async (command: string) => {
    invokeCalls.push(command);
    if (command === "ai_complete") return { text: "ok", truncated: false, model: "m" };
    if (command === "ai_status") return { installed: true, keyStored: true };
    return null;
  },
}));

const {
  aiConsentGiven,
  aiConsentKey,
  answerAiConsent,
  isAiFeatureId,
  isLocalAiProfile,
  requestAiConsent,
  useAiAccess,
} = await import("@/lib/ai/access");
const { EditorAiUnavailable, runEditorAi } = await import("@/lib/ai/editor/client");
const { editorAiOn, useEditorAiSettings } = await import("@/lib/ai/editor/settings");
const { editorAiAvailable } = await import("@/lib/ai/editor/use-editor-ai-available");
const { useAiStore } = await import("@/lib/ai/store");
const { aiComplete, aiRun, aiStatus } = await import("@/lib/db/ai");
const { isHotkeyAvailable } = await import("@/lib/hotkeys");
const { hasNewFeatures } = await import("@/lib/new-features");
const { FEATURE_CATALOG } = await import("@/lib/discovery/catalog");
const { buildFeatureItems } = await import("@/features/shell/app-header-search/command-items");

import type { AiProfile } from "@/lib/db/ai";

function profile(patch: Partial<AiProfile> = {}): AiProfile {
  return {
    id: "p1",
    provider: "anthropic",
    binary: "",
    home: "",
    endpoint: "",
    model: "m",
    effort: "",
    mode: "",
    ...patch,
  };
}

const request = (action: "inline" | "edit", target = profile()) =>
  runEditorAi({ action, cached: "schema", messages: [], maxTokens: 1, profile: target });

const completeRequest = (target: AiProfile) => ({
  runId: "r",
  profile: target,
  cached: "",
  system: "",
  messages: [],
  maxTokens: 1,
});

const savedAi = {
  profiles: useAiStore.getState().profiles,
  profileId: useAiStore.getState().profileId,
};

afterAll(() => {
  useAiStore.setState(savedAi);
  useAiAccess.setState({ enabled: true, consent: [], pending: null });
});

beforeEach(() => {
  invokeCalls.length = 0;
  answerAiConsent(false);
  useAiAccess.setState({ enabled: true, consent: [], pending: null });
  useEditorAiSettings.getState().reset();
  useAiStore.setState({ profiles: [profile()], profileId: "p1" });
});

describe("global AI switch", () => {
  test("off blocks every request at the bridge and in the editor client", async () => {
    useAiAccess.setState({ enabled: false, consent: ["anthropic"] });
    await expect(aiComplete(completeRequest(profile()), () => {})).rejects.toThrow("ausgeschaltet");
    await expect(aiStatus(profile())).rejects.toThrow("ausgeschaltet");
    await expect(request("edit")).rejects.toBeInstanceOf(EditorAiUnavailable);
    await expect(request("inline")).rejects.toBeInstanceOf(EditorAiUnavailable);
    await expect(requestAiConsent(profile())).resolves.toBe(false);
    expect(invokeCalls).toEqual([]);
    expect(editorAiOn()).toBe(false);
  });

  test("off hides hotkeys, palette entries, NEW badges and fix buttons", () => {
    useAiAccess.setState({ enabled: true, consent: ["anthropic"] });
    const context = { hasConnection: true, capabilities: undefined };
    expect(isHotkeyAvailable("ai.toggle", context)).toBe(true);
    expect(editorAiAvailable()).toBe(true);
    const aiEntry = FEATURE_CATALOG.find((entry) => entry.id === "ai.chat");
    expect(aiEntry).toBeDefined();
    const search = () =>
      buildFeatureItems("KI", false, { limit: 50 }, () => {}).map((item) => item.id);
    expect(search()).toContain("feature:ai.chat");

    useAiAccess.getState().setEnabled(false);
    for (const id of ["ai.toggle", "query.aiEdit", "query.aiAsk"])
      expect(isHotkeyAvailable(id, context)).toBe(false);
    expect(isHotkeyAvailable("query.format", context)).toBe(true);
    expect(search().some((id) => isAiFeatureId(id.slice("feature:".length)))).toBe(false);
    expect(hasNewFeatures("ai", new Set(), undefined, false)).toBe(false);
    expect(hasNewFeatures("settings.general.ki", new Set(), "0.19.0", false)).toBe(true);
    expect(editorAiAvailable()).toBe(false);
  });

  test("feature ids are classified as AI only for real AI features", () => {
    for (const id of [
      "ai.chat",
      "query.result.ask-ai",
      "table.filter.ai",
      "settings.editor.ai-metrics",
      "query.ai-edit",
    ])
      expect(isAiFeatureId(id)).toBe(true);
    for (const id of [
      "settings.general.ki",
      "drivers.repair",
      "discover.wait-tips",
      "tasks.sql-log",
    ])
      expect(isAiFeatureId(id)).toBe(false);
  });
});

describe("fix with AI button", () => {
  test("renders only when the editor AI can run", () => {
    expect(editorAiAvailable()).toBe(true);
    useEditorAiSettings.getState().update({ enabled: false });
    expect(editorAiAvailable()).toBe(false);
    useEditorAiSettings.getState().update({ enabled: true });
    useAiStore.setState({ profiles: [] });
    expect(editorAiAvailable()).toBe(false);
    useAiStore.setState({ profiles: [profile({ provider: "gemini-cli" })] });
    expect(editorAiAvailable()).toBe(false);
  });
});

describe("provider consent", () => {
  test("background requests send nothing until consent", async () => {
    await expect(request("inline")).rejects.toThrow("nicht freigegeben");
    await expect(aiComplete(completeRequest(profile()), () => {})).rejects.toThrow(
      "nicht freigegeben",
    );
    expect(invokeCalls).toEqual([]);
  });

  test("an explicit action asks once, cancel sends nothing, allow persists", async () => {
    const cancelled = request("edit");
    expect(useAiAccess.getState().pending?.provider).toBe("anthropic");
    answerAiConsent(false);
    await expect(cancelled).rejects.toBeInstanceOf(EditorAiUnavailable);
    expect(invokeCalls).toEqual([]);

    const allowed = request("edit");
    answerAiConsent(true);
    expect((await allowed).text).toBe("ok");
    expect(useAiAccess.getState().consent).toEqual(["anthropic"]);
    expect((await request("inline")).text).toBe("ok");
    expect(invokeCalls).toEqual(["ai_complete", "ai_complete"]);

    useAiAccess.getState().revoke("anthropic");
    await expect(request("inline")).rejects.toThrow("nicht freigegeben");
    expect(invokeCalls).toHaveLength(2);
  });

  test("chat runs need consent, the setup probe does not", async () => {
    const run = {
      runId: "r",
      profile: profile({ provider: "codex" }),
      cwd: "",
      sessionId: null,
      messages: [],
      connections: [],
      activeId: null,
      skills: [],
      servers: [],
      allowWrites: false,
      allowDdl: false,
      attachments: [],
    };
    await expect(aiRun(run, () => {})).rejects.toThrow("nicht freigegeben");
    await aiRun(run, () => {}, false);
    expect(invokeCalls).toEqual(["ai_run"]);
  });

  test("local providers bypass consent, remote endpoints do not", async () => {
    const local = profile({ provider: "ollama" });
    expect(isLocalAiProfile(local)).toBe(true);
    expect(
      isLocalAiProfile(profile({ provider: "lmstudio", endpoint: "http://127.0.0.1:1234/v1" })),
    ).toBe(true);
    expect(
      isLocalAiProfile(profile({ provider: "compatible", endpoint: "http://localhost:8080/v1" })),
    ).toBe(true);
    expect(
      isLocalAiProfile(profile({ provider: "ollama", endpoint: "https://gpu.example.com" })),
    ).toBe(false);
    expect(isLocalAiProfile(profile({ provider: "compatible" }))).toBe(false);
    expect(isLocalAiProfile(profile({ provider: "openai", endpoint: "http://localhost" }))).toBe(
      false,
    );
    expect(
      aiConsentKey(profile({ provider: "compatible", endpoint: "https://api.example.com/v1" })),
    ).toBe("compatible@api.example.com");
    expect((await request("inline", local)).text).toBe("ok");
    expect((await request("edit", local)).text).toBe("ok");
    expect(useAiAccess.getState().pending).toBeNull();
    expect(aiConsentGiven(local)).toBe(true);
    expect(invokeCalls).toEqual(["ai_complete", "ai_complete"]);
  });

  test("turning AI off answers a pending prompt with no", async () => {
    const pending = requestAiConsent(profile());
    useAiAccess.setState({ enabled: false });
    await expect(pending).resolves.toBe(false);
    expect(useAiAccess.getState().pending).toBeNull();
    expect(useAiAccess.getState().consent).toEqual([]);
  });
});

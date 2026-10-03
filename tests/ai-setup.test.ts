import { expect, test } from "bun:test";
import { aiReady } from "@/lib/ai/setup";
import type { AiProfile, AiStatus } from "@/lib/db/ai";

const profile = (provider: AiProfile["provider"], endpoint = ""): AiProfile => ({
  id: provider,
  provider,
  binary: "",
  home: "",
  endpoint,
  model: "",
  effort: "",
  mode: "",
});
const status = (installed: boolean, keyStored: boolean): AiStatus => ({
  provider: "",
  installed,
  version: null,
  keyStored,
});

test("AI onboarding counts an installed CLI, a stored key or a compatible endpoint as set up", () => {
  expect(aiReady(profile("claude"), status(true, false))).toBe(true);
  expect(aiReady(profile("claude"), status(false, true))).toBe(false);
  expect(aiReady(profile("openai"), status(true, false))).toBe(false);
  expect(aiReady(profile("openai"), status(true, true))).toBe(true);
  expect(aiReady(profile("compatible", "http://localhost:11434/v1"), status(true, false))).toBe(
    true,
  );
  expect(aiReady(profile("compatible"), status(true, false))).toBe(false);
  expect(aiReady(profile("codex"), null)).toBe(false);
});

test("local model providers count as set up only while their server answers", () => {
  expect(aiReady(profile("ollama", "http://localhost:11434/v1"), status(true, false))).toBe(true);
  expect(aiReady(profile("lmstudio", "http://localhost:1234/v1"), status(false, false))).toBe(
    false,
  );
});

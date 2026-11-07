import { expect, test } from "bun:test";
import { aiBranches, aiLatestLeaf, aiThread } from "@/lib/ai/thread";
import type { AiMessage } from "@/lib/db/ai";

const m = (id: string, parentId?: string | null): AiMessage => ({
  id,
  role: id.startsWith("u") ? "user" : "assistant",
  text: id,
  ...(parentId !== undefined ? { parentId } : {}),
});

test("legacy linear sessions without parent ids keep their order", () => {
  const messages = [m("u1"), m("a1"), m("u2"), m("a2")];
  expect(aiThread({ messages }).map((entry) => entry.id)).toEqual(["u1", "a1", "u2", "a2"]);
});

test("edits and retries branch from the shared parent and switch by leaf", () => {
  const messages = [
    m("u1"),
    m("a1"),
    m("u2"),
    m("a2"),
    m("u2b", "a1"),
    m("a2b", "u2b"),
    m("a2c", "u2b"),
  ];
  expect(aiThread({ messages }).map((entry) => entry.id)).toEqual(["u1", "a1", "u2b", "a2c"]);
  const branches = aiBranches({ messages });
  expect(branches.get("u2b")).toEqual(["u2", "u2b"]);
  expect(branches.get("a2b")).toEqual(["a2b", "a2c"]);
  expect(branches.get("a1")).toEqual(["a1"]);
  const leafId = aiLatestLeaf({ messages }, "u2");
  expect(leafId).toBe("a2");
  expect(aiThread({ messages, leafId }).map((entry) => entry.id)).toEqual(["u1", "a1", "u2", "a2"]);
});

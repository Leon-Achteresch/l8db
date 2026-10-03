import { expect, test } from "bun:test";
import { aiRaster, interleaveAiRich, mergeAiRich, normalizeAiRich } from "../src/lib/ai/rich";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=";
test("native plans clear and partial tools preserve previous status and text", () => {
  const initial = normalizeAiRich({
    kind: "tool",
    data: {
      id: "a",
      name: "SQL",
      status: "completed",
      result: [{ type: "text", text: "Rows found" }],
    },
  });
  expect(
    mergeAiRich(initial, normalizeAiRich({ kind: "tool", data: { id: "a" } }))[0],
  ).toMatchObject({ name: "SQL", status: "success", output: "Rows found" });
  const plan = normalizeAiRich({
    kind: "metadata",
    data: { plan: [{ step: "Inspect", status: "inProgress" }] },
  });
  expect(plan[0]).toMatchObject({
    type: "plan",
    items: [{ title: "Inspect", status: "in-progress" }],
  });
  expect(
    mergeAiRich(plan, normalizeAiRich({ kind: "metadata", data: { plan: [] } }))[0],
  ).toMatchObject({ items: [] });
});
test("native ACP diff, raster artifacts and source links have dedicated rich blocks", () => {
  const blocks = normalizeAiRich({
    kind: "tool",
    data: {
      id: "tool",
      name: "list_tables",
      status: "completed",
      arguments: {
        connection: "Analytics",
        schema: "public",
        table: "users",
        password: "never-store",
      },
      result: {
        content: [
          { type: "diff", path: "query.sql", oldText: "SELECT 1", newText: "SELECT 2" },
          { type: "content", content: { type: "image", mimeType: "image/png", data: png } },
          { type: "resource_link", uri: "https://example.com/source", name: "Source" },
        ],
      },
    },
  });
  expect(blocks.some((b) => b.type === "diff" && b.path === "query.sql")).toBe(true);
  expect(blocks.some((b) => b.type === "image" && b.src?.startsWith("data:image/png;"))).toBe(true);
  expect(
    blocks.some((b) => b.type === "citation" && b.description === "Analytics · public · users"),
  ).toBe(true);
  expect(JSON.stringify(blocks)).not.toContain("never-store");
  expect(blocks.find((b) => b.type === "tool")).toMatchObject({
    output: expect.stringContaining("Bild-Ergebnis"),
  });
  expect(
    normalizeAiRich({
      kind: "artifact",
      data: { content: { type: "image", mimeType: "image/png", data: png } },
    })[0],
  ).toMatchObject({ type: "image", status: "complete" });
});
test("raster images reject oversized, malformed, mismatched and SVG payloads", () => {
  expect(aiRaster(png)).toBe(`data:image/png;base64,${png}`);
  for (const input of [
    "A".repeat(2_000_001),
    `${png}!`,
    png.slice(1),
    btoa("<svg xmlns='http://www.w3.org/2000/svg'/>"),
  ])
    expect(aiRaster(input)).toBeUndefined();
  expect(aiRaster(png, "image/jpeg")).toBeUndefined();
  expect(aiRaster(png, "image/svg+xml")).toBeUndefined();
  expect(
    normalizeAiRich({
      kind: "tool",
      data: {
        id: "image",
        status: "completed",
        result: { type: "imageGeneration", savedPath: "/tmp/image.png" },
      },
    }).find((b) => b.type === "image"),
  ).toMatchObject({ status: "error", src: undefined });
});
test("rich history retains bounded output and sources without raw credentials", () => {
  const blocks = normalizeAiRich({
    kind: "tool",
    data: {
      id: "a",
      status: "completed",
      arguments: { apiKey: "secret-value" },
      result: { rows: [{ name: "User", password: "secret-value" }], authorization: "secret-value" },
    },
  });
  expect(JSON.stringify(blocks)).not.toContain("secret-value");
  expect(JSON.stringify(blocks)).toContain("User");
  const citations = normalizeAiRich({
    kind: "metadata",
    data: {
      citations: [
        { path: "MEMORY.md", title: "Native memory" },
        { url: "https://example.com/?token=private", title: "Native web" },
      ],
    },
  });
  expect(citations).toHaveLength(2);
  expect(JSON.stringify(citations)).not.toContain("private");
  expect(
    mergeAiRich(
      [],
      Array.from({ length: 200 }, (_, index) => ({
        type: "tool" as const,
        id: String(index),
        name: "Tool",
        status: "success",
        output: "",
      })),
    ),
  ).toHaveLength(80);
});

test("tool blocks stay at the text position where they happened", () => {
  const tool = (id: string) => ({
    type: "tool" as const,
    id,
    name: id,
    status: "running",
    output: "",
  });
  let rich = mergeAiRich([], [tool("a")], 5);
  rich = mergeAiRich(rich, [{ ...tool("a"), status: "success" }], 12);
  rich = mergeAiRich(rich, [tool("b")], 5);
  rich = mergeAiRich(rich, [{ type: "citation", id: "c", title: "Quelle" }], 0);
  const parts = interleaveAiRich("Hallo\n\nWelt", rich);
  expect(parts.map((part) => [part.text, part.blocks.map((block) => block.id)])).toEqual([
    ["Hallo", ["a", "b"]],
    ["\n\nWelt", ["c"]],
    ["", []],
  ]);
  expect(interleaveAiRich("Alt", [tool("x")])).toEqual([
    { text: "Alt", blocks: [tool("x")] },
    { text: "", blocks: [] },
  ]);
});

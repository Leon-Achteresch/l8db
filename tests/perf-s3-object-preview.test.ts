import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { ObjectPreview } from "../src/features/storage/object-preview";
import {
  initialPreviewLimit,
  nextPreviewLimit,
  objectPreviewContent,
} from "../src/features/storage/object-preview-content";
import type { ObjectPreview as Preview } from "../src/lib/db";

const MiB = 1024 * 1024;
function response(bytes: string | Uint8Array, mime: string, size?: number): Preview {
  const buffer = Buffer.from(bytes);
  return {
    content_type: mime,
    size: size ?? buffer.length,
    truncated: size !== undefined && size > buffer.length,
    data: buffer.toString("base64"),
  };
}

test("S3 ranges follow the listed size, actual MIME type and the version's reported size", () => {
  expect(initialPreviewLimit("report.pdf", null)).toBe(2048);
  expect(initialPreviewLimit("raw", 12345)).toBe(2048);
  expect(initialPreviewLimit("report.txt", null)).toBe(MiB / 4);
  expect(initialPreviewLimit("p.jpg", 12 * MiB)).toBe(12 * MiB);
  expect(initialPreviewLimit("p.jpg", 12 * MiB + 1)).toBe(2048);
  expect(initialPreviewLimit("p.jpg", null)).toBe(12 * MiB);
  expect(nextPreviewLimit("image", response("", "image/png", 4888), 2048)).toBe(4888);
  expect(nextPreviewLimit("image", response("", "image/png", 12 * MiB + 1), 2048)).toBeNull();
  expect(
    nextPreviewLimit("binary", response("", "application/octet-stream", MiB), 2048),
  ).toBeNull();
  const text = response("", "text/plain", 24 * MiB);
  expect(nextPreviewLimit("text", text, 2048)).toBe(MiB / 4);
  expect(nextPreviewLimit("text", text, 2 * MiB)).toBe(16 * MiB);
  expect(nextPreviewLimit("text", text, 16 * MiB)).toBeNull();
  expect(nextPreviewLimit("text", response("done", "text/plain"), MiB / 4)).toBeNull();
  const unknown = { ...text, size: null };
  expect(nextPreviewLimit("text", unknown, MiB / 4)).toBe(2 * MiB);
  expect(nextPreviewLimit("text", unknown, 16 * MiB)).toBeNull();
  expect(nextPreviewLimit("image", unknown, 2048)).toBe(12 * MiB);
  expect(nextPreviewLimit("image", unknown, 12 * MiB)).toBeNull();
});

test("partial text keeps complete UTF-8 characters and complete CSV and TSV records", () => {
  const euro = Buffer.from("a€");
  expect(objectPreviewContent("log", response(euro.subarray(0, 3), "text/plain", 4)).text).toBe(
    "a",
  );
  expect(objectPreviewContent("log", response(euro, "text/plain")).text).toBe("a€");
  const tsv = response(
    'id\ttext\r\n1\t"two\nlines"\r\n',
    "text/tab-separated-values; charset=utf-8",
    128,
  );
  expect(objectPreviewContent("table", tsv)).toMatchObject({
    kind: "csv",
    columns: ["id", "text"],
    rows: [["1", "two\nlines"]],
  });
  expect(objectPreviewContent("table.csv", response("a,b\n1,2\n3,", "text/csv", 128)).rows).toEqual(
    [["1", "2"]],
  );
  expect(objectPreviewContent("table.csv", response("a,b\n1,2\n3,", "text/csv")).rows).toEqual([
    ["1", "2"],
    ["3", ""],
  ]);
  expect(objectPreviewContent("doc.json", response('{"a":1}', "application/json")).text).toBe(
    '{\n  "a": 1\n}',
  );
  expect(objectPreviewContent("empty.pdf", response("", "application/pdf")).text).toBe("");
  const binary = Buffer.alloc(8192, 65);
  binary[2047] = 90;
  expect(
    objectPreviewContent("data.bin", response(binary, "application/octet-stream")),
  ).toMatchObject({ bytes: 2048 });
  expect(
    objectPreviewContent("report.pdf", response(binary, "application/pdf"))
      .text?.split("\n")
      .at(-1),
  ).toMatch(/^000007f0 .*Z$/);
});

test("S3 renders oversized image and PDF previews within the read and decoding budgets", async () => {
  const client = new QueryClient();
  const files = [
    { key: "photo.jpg", mime: "image/jpeg", size: 32 * MiB },
    { key: "report.pdf", mime: "application/pdf", size: 4 * MiB },
  ];
  let requested = 0;
  for (const file of files) {
    const limit = initialPreviewLimit(file.key, file.size);
    requested += limit;
    client.setQueryData(
      ["s3", undefined, "preview", "sample", file.key, "v2", limit],
      response(Buffer.alloc(limit, 65), file.mime, file.size),
    );
  }
  let calls = 0;
  let characters = 0;
  let html = "";
  const original = globalThis.atob;
  globalThis.atob = (input) => {
    calls++;
    characters += input.length;
    return original(input);
  };
  try {
    const timing = await measureScenario(() => {
      calls = 0;
      characters = 0;
      html = renderToStaticMarkup(
        createElement(
          QueryClientProvider,
          { client },
          ...files.map((file) =>
            createElement(ObjectPreview, {
              key: file.key,
              objectKey: file.key,
              listedSize: file.size,
              bucket: "sample",
              versionId: "v2",
            }),
          ),
        ),
      );
      if (!html.includes("000007f0") || !html.includes("Bild ist zu groß"))
        throw new Error("Missing preview");
    }, 21);
    expect(requested).toBe(4096);
    expect(calls).toBe(1);
    expect(characters).toBe(2732);
    expect(Buffer.byteLength(html)).toBeLessThan(16 * 1024);
    expect(timing.medianMs).toBeLessThan(5);
    expect(timing.p95Ms).toBeLessThan(9);
    await reportScenario("s3-object-preview-ranges", { ...timing, requested, calls, characters });
  } finally {
    globalThis.atob = original;
    client.clear();
  }
});

import { describe, expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import {
  documentColumnDetails,
  documentColumns,
  documentRows,
  isConvexId,
  parseEditedValue,
} from "../src/features/baas/convex-studio/data/convex-data-utils";
import { validatorTemplate } from "../src/features/baas/convex-studio/functions/convex-validator";
import type { ConvexDocument } from "../src/lib/db/convex-studio-data";

describe("convex studio utils", () => {
  test("isConvexId checks the id checksum", () => {
    expect(isConvexId("j57bch2sxf2zkfnndw3yxdz7d18gr5ck")).toBe(true);
    expect(isConvexId("jh77h264nvzj8hjr36845km6rh8grxac")).toBe(true);
    expect(isConvexId("d41d8cd98f00b204e9800998ecf8427e")).toBe(false);
    expect(isConvexId("272cabc0647049b3f51e87ed530aa0d9")).toBe(false);
    expect(isConvexId("j57bch2sxf2zkfnndw3yxdz7d18gr5cm")).toBe(false);
  });

  test("templates use Convex JSON for int64 and bytes", () => {
    expect(
      validatorTemplate({
        type: "object",
        value: {
          count: { fieldType: { type: "int64" } },
          raw: { fieldType: { type: "bytes" } },
          ratio: { fieldType: { type: "float64" } },
        },
      }),
    ).toEqual({ count: { $integer: "AAAAAAAAAAA=" }, raw: { $bytes: "" }, ratio: 0 });
  });

  test("grid edits keep strings and parse other values as JSON", () => {
    expect(parseEditedValue("42", "41")).toBe("42");
    expect(parseEditedValue("42", 41)).toBe(42);
    expect(parseEditedValue('{"a":1}', { a: 0 })).toEqual({ a: 1 });
    expect(parseEditedValue("true", undefined)).toBe(true);
    expect(parseEditedValue("kein json", 1)).toBe("kein json");
    expect(parseEditedValue(null, "x")).toBeNull();
    expect(parseEditedValue("42", undefined, { type: "string" })).toBe("42");
    expect(parseEditedValue("42", "41", { type: "float64" })).toBe(42);
  });

  test("documents map to grid rows with id and ISO creation time", () => {
    const [row] = documentRows([{ _id: "abc", _creationTime: 0, n: 1 }]);
    expect(row).toEqual({
      _id: "abc",
      _creationTime: "1970-01-01T00:00:00.000Z",
      n: 1,
      __ctid__: "abc",
    });
    const details = documentColumnDetails(["_id", "n", "_creationTime"], "messages", {
      n: { fieldType: { type: "float64" }, optional: true },
    });
    expect(details.map((column) => column.data_type)).toEqual([
      'Id<"messages">',
      "number",
      "timestamptz",
    ]);
    expect(details[0].is_primary_key).toBe(true);
    expect(details[1].is_nullable).toBe(true);
  });

  test("grid rows for a full page stay fast", async () => {
    const page: ConvexDocument[] = Array.from({ length: 50 }, (_, index) => ({
      _id: `id${index}`,
      _creationTime: 1_700_000_000_000 + index,
      author: `user${index % 7}`,
      body: "x".repeat(200),
      meta: { tags: ["a", "b"], score: index },
    }));
    let rows = documentRows(page);
    const timing = await measureScenario(() => {
      for (let run = 0; run < 200; run++) {
        const columns = documentColumns(page, undefined);
        rows = documentRows(page);
        documentColumnDetails(columns, "messages", null);
      }
    });
    expect(rows).toHaveLength(50);
    expect(timing.p95Ms).toBeLessThan(60);
    await reportScenario("convex-data-grid-rows", { ...timing, documents: 50, runsPerSample: 200 });
  });
});

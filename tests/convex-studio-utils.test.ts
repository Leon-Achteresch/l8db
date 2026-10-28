import { describe, expect, test } from "bun:test";
import { isConvexId } from "../src/features/baas/convex-studio/data/convex-data-utils";
import { validatorTemplate } from "../src/features/baas/convex-studio/functions/convex-validator";

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
});

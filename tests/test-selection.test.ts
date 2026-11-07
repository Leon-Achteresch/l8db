import { expect, test } from "bun:test";
import { selectTestFiles } from "../scripts/test-selection";

test("default regression selection keeps performance budgets in the separate local suite", () => {
  expect(
    selectTestFiles(
      [],
      [
        "tests/z.test.ts",
        "tests/perf-grid-style.test.ts",
        "tests/nested/perf-versioning-ledger.test.ts",
        "tests/a.test.ts",
        "tests/performance-report.test.ts",
        "tests/perf-load.test.ts",
        "tests/perf-test.test.ts",
      ],
    ),
  ).toEqual({
    flags: [],
    files: [
      "tests/a.test.ts",
      "tests/perf-load.test.ts",
      "tests/perf-test.test.ts",
      "tests/performance-report.test.ts",
      "tests/z.test.ts",
    ],
  });
});

test("explicit performance and regression files preserve caller order and Bun flags", () => {
  expect(
    selectTestFiles(
      ["--timeout", "30000", "tests/perf-grid-style.test.ts", "tests/a.test.ts"],
      ["tests/unselected.test.ts"],
    ),
  ).toEqual({
    files: ["tests/perf-grid-style.test.ts", "tests/a.test.ts"],
    flags: ["--timeout", "30000"],
  });
});

import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import type { CompileErrorInfo, InvalidObjectInfo } from "../src/lib/db";
import {
  buildInvalidProblems,
  filterInvalidProblems,
  INVALID_ERRORS_PER_OBJECT,
  INVALID_RENDER_STEP,
  invalidTypeLabels,
} from "../src/lib/invalid-objects";

const TYPES = ["PACKAGE BODY", "FUNCTION", "PROCEDURE", "VIEW", "TRIGGER", "TYPE BODY"];

function workload(objects: number, errorsPerObject: number) {
  const items: InvalidObjectInfo[] = Array.from({ length: objects }, (_, index) => ({
    schema: `APP_${index % 12}`,
    name: `OBJECT_${index}`,
    object_type: TYPES[index % TYPES.length],
    status: "INVALID",
    oid: String(index),
  }));
  const errors: CompileErrorInfo[] = items.flatMap((item, index) =>
    Array.from({ length: index % 50 === 0 ? 80 : errorsPerObject }, (_, line) => ({
      schema: item.schema,
      name: item.name,
      object_type: item.object_type,
      line: line + 1,
      position: 4,
      message: `PLS-00201: identifier 'DEP_${line}' must be declared`,
    })),
  );
  return { items, errors };
}

test("20k invalid objects with 90k compile messages group and filter within budget", async () => {
  const { items, errors } = workload(20_000, 3);
  const build = await measureScenario(() => {
    buildInvalidProblems(items, errors);
  });
  const { problems, others, matched } = buildInvalidProblems(items, errors);
  const filter = await measureScenario(() => {
    filterInvalidProblems(problems, "Funktion", "app_3.object_1");
    filterInvalidProblems(problems, null, "object_19");
    invalidTypeLabels(items);
  });
  const unfiltered = filterInvalidProblems(problems, null, "");
  await reportScenario("invalid-objects-problems", {
    objects: items.length,
    compileMessages: errors.length,
    build,
    filter,
    limits: { renderStep: INVALID_RENDER_STEP, errorsPerObject: INVALID_ERRORS_PER_OBJECT },
  });
  expect(unfiltered).toBe(problems);
  expect(problems[0].errors[0]).toBe(errors[0]);
  expect(problems.reduce((sum, problem) => sum + problem.errors.length, 0)).toBe(errors.length);
  expect(matched).toBe(errors.length);
  expect(others).toHaveLength(0);
  expect(build.p95Ms).toBeLessThan(120);
  expect(filter.p95Ms).toBeLessThan(60);
});

test("messages for valid objects are kept separately without copying the list", async () => {
  const { items, errors } = workload(5_000, 3);
  const warnings: CompileErrorInfo[] = Array.from({ length: 50_000 }, (_, index) => ({
    schema: "APP_0",
    name: `VALID_${index % 10_000}`,
    object_type: "PROCEDURE",
    line: index,
    position: 1,
    message: "PLW-06009: procedure OTHERS handler does not end in RAISE",
  }));
  const all = [...errors, ...warnings];
  const build = await measureScenario(() => {
    buildInvalidProblems(items, all);
  });
  const result = buildInvalidProblems(items, all);
  await reportScenario("invalid-objects-unmatched", {
    objects: items.length,
    compileMessages: all.length,
    unmatched: result.others.length,
    build,
  });
  expect(result.matched + result.others.length).toBe(all.length);
  expect(result.others[0]).toBe(warnings[0]);
  expect(build.p95Ms).toBeLessThan(120);
});

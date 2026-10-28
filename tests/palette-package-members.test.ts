import { expect, test } from "bun:test";
import type { CommandItem } from "../src/components/motion/command-palette/types";
import {
  buildObjectItems,
  buildPackageMemberItems,
} from "../src/features/shell/app-header-search/command-items";
import { nestUnderParents, withoutChildren } from "../src/lib/command-palette-search";
import { rankCommands } from "../src/lib/command-score";
import type { FunctionInfo, PackageMemberInfo } from "../src/lib/db";

type Navigate = Parameters<typeof buildPackageMemberItems>[2];

function pkg(name: string): FunctionInfo {
  return {
    oid: `HR\u001f${name}\u001fPACKAGE`,
    schema: "HR",
    name,
    identity_args: "",
    return_type: "PACKAGE",
    language: "PL/SQL",
  };
}

function packageWorkload(packages: number, membersPerPackage: number) {
  const functions = Array.from({ length: packages }, (_, index) => pkg(`PKG_${index}`));
  const members: PackageMemberInfo[] = functions.flatMap((fn, index) =>
    Array.from({ length: membersPerPackage }, (_, member) => ({
      schema: "HR",
      package: fn.name,
      name: member === 0 && index % 500 === 0 ? "CALC_BONUS" : `PROC_${index}_${member}`,
    })),
  );
  return { functions, members };
}

function search(items: CommandItem[], query: string, max = 60) {
  const byId = new Map(items.map((item) => [item.id, item] as const));
  return nestUnderParents(rankCommands(withoutChildren(items, query), query).slice(0, max), byId);
}

test("Package-Funktion erscheint eingerückt direkt unter ihrem Package", () => {
  const calls: unknown[] = [];
  const navigate = ((options: unknown) => {
    calls.push(options);
    return Promise.resolve();
  }) as Navigate;
  const objects = { functions: [pkg("PAYROLL"), pkg("BILLING")] };
  const members = [
    { schema: "HR", package: "PAYROLL", name: "CALC_BONUS" },
    { schema: "HR", package: "PAYROLL", name: "CALC_TAX" },
    { schema: "HR", package: "BILLING", name: "SEND_INVOICE" },
  ];
  const items = [
    ...buildObjectItems(objects, () => {}, navigate),
    ...buildPackageMemberItems(members, () => {}, navigate),
  ];
  const results = search(items, "calc_bonus");
  expect(results.map((item) => [item.label, item.group, Boolean(item.parentId)])).toEqual([
    ["PAYROLL", "Packages", false],
    ["CALC_BONUS", "Packages", true],
  ]);
  results[1].onSelect();
  expect(calls).toEqual([
    {
      to: "/packages/$schema/$name",
      params: { schema: "HR", name: "PAYROLL" },
      search: { part: "body", member: "CALC_BONUS" },
    },
  ]);
  const calc = search(items, "calc").map((item) => item.label);
  expect(calc[0]).toBe("PAYROLL");
  expect(calc.slice(1).sort()).toEqual(["CALC_BONUS", "CALC_TAX"]);
  expect(search(items, "payroll.calc_b").map((item) => item.label)).toEqual([
    "PAYROLL",
    "CALC_BONUS",
  ]);
  expect(search(items, "").map((item) => item.label)).toEqual(["PAYROLL", "BILLING"]);
});

test("Package-Funktionen ohne bekanntes Package bleiben sichtbar", () => {
  const navigate = (() => Promise.resolve()) as Navigate;
  const items = buildPackageMemberItems(
    [{ schema: "HR", package: "GONE", name: "ORPHAN" }],
    () => {},
    navigate,
  );
  expect(search(items, "orphan").map((item) => [item.label, item.parentId])).toEqual([
    ["ORPHAN", undefined],
  ]);
});

test("Package-Funktionssuche bleibt bei 40.000 Funktionen schnell und begrenzt", () => {
  const navigate = (() => Promise.resolve()) as Navigate;
  const { functions, members } = packageWorkload(2000, 20);
  const build = () => [
    ...buildObjectItems({ functions }, () => {}, navigate),
    ...buildPackageMemberItems(members, () => {}, navigate),
  ];
  const items = build();
  expect(items).toHaveLength(42000);
  const byId = new Map(items.map((item) => [item.id, item] as const));
  const durations: number[] = [];
  let results: CommandItem[] = [];
  for (let run = 0; run < 15; run++) {
    const started = performance.now();
    results = nestUnderParents(
      rankCommands(withoutChildren(items, "calc_bonus"), "calc_bonus").slice(0, 60),
      byId,
    );
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  const median = durations[Math.floor(durations.length / 2)];
  const p95 = durations[Math.ceil(durations.length * 0.95) - 1];
  console.info(`package member search: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  expect(median).toBeLessThan(150);
  expect(p95).toBeLessThan(300);
  expect(results).toHaveLength(8);
  expect(results.filter((item) => item.parentId)).toHaveLength(4);
  expect(search(items, "pkg", 60).length).toBeLessThanOrEqual(120);
  expect(withoutChildren(items, "")).toHaveLength(2000);
});

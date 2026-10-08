import { describe, expect, test } from "bun:test";
import {
  filterPackages,
  groupPackageMembers,
  matchingMembersWindow,
  packageMemberKey,
} from "../src/features/sidebar/sidebar-package-list/filter-packages";
import { compileSearchPatterns } from "../src/lib/regex-search";

const packages = [
  { schema: "HR", name: "PAYROLL" },
  { schema: "HR", name: "REPORTS" },
  { schema: "SALES", name: "PAYROLL" },
];
const members = groupPackageMembers([
  { schema: "HR", package: "PAYROLL", name: "CALCULATE_TOTAL" },
  { schema: "HR", package: "PAYROLL", name: "CALCULATE_TOTAL" },
  { schema: "HR", package: "PAYROLL", name: "PAY_SALARY" },
  { schema: "HR", package: "REPORTS", name: "EXPORT_REPORT" },
  { schema: "SALES", package: "PAYROLL", name: "CALCULATE_TAX" },
]);

describe("package function search", () => {
  test("finds function and procedure names without matching the package name", () => {
    expect(filterPackages(packages, members, " total ; export ", true, null)).toEqual([
      { schema: "HR", name: "PAYROLL", matchingMembers: ["CALCULATE_TOTAL"] },
      { schema: "HR", name: "REPORTS", matchingMembers: ["EXPORT_REPORT"] },
    ]);
    expect(filterPackages(packages, members, "pay_salary", true, null)).toEqual([
      { schema: "HR", name: "PAYROLL", matchingMembers: ["PAY_SALARY"] },
    ]);
  });

  test("keeps package name matches and limits disabled searches to package names", () => {
    expect(filterPackages(packages, members, "payroll", true, null)).toEqual([
      { schema: "HR", name: "PAYROLL", matchingMembers: [] },
      { schema: "SALES", name: "PAYROLL", matchingMembers: [] },
    ]);
    expect(filterPackages(packages, members, "payroll", false, null)).toEqual([
      packages[0],
      packages[2],
    ]);
    expect(filterPackages(packages, members, "total", false, null)).toEqual([]);
    expect(filterPackages(packages, new Map(), "reports", true, null)).toEqual([
      { schema: "HR", name: "REPORTS", matchingMembers: [] },
    ]);
  });

  test("deduplicates overload names and keeps identically named packages in separate schemas", () => {
    expect(members.get(packageMemberKey("HR", "PAYROLL"))).toEqual([
      "CALCULATE_TOTAL",
      "PAY_SALARY",
    ]);
    expect(filterPackages(packages, members, "tax", true, null)).toEqual([
      { schema: "SALES", name: "PAYROLL", matchingMembers: ["CALCULATE_TAX"] },
    ]);
    const dotted = groupPackageMembers([
      { schema: "A.B", package: "C", name: "FIRST" },
      { schema: "A", package: "B.C", name: "SECOND" },
    ]);
    expect(dotted.size).toBe(2);
  });

  test("uses the same wildcard and regex matching as table column searches", () => {
    const pattern = "calculate*;^export_.*$";
    expect(
      filterPackages(
        packages,
        members,
        pattern,
        true,
        compileSearchPatterns(pattern, { global: false }),
      ),
    ).toEqual([
      { schema: "HR", name: "PAYROLL", matchingMembers: ["CALCULATE_TOTAL"] },
      { schema: "HR", name: "REPORTS", matchingMembers: ["EXPORT_REPORT"] },
      { schema: "SALES", name: "PAYROLL", matchingMembers: ["CALCULATE_TAX"] },
    ]);
    expect(filterPackages(packages, members, "calculate*", true, null)).toEqual([]);
  });

  test("keeps all packages for empty or invalid patterns and handles missing metadata", () => {
    expect(filterPackages(packages, members, " ; ", true, null)).toBe(packages);
    const invalid = compileSearchPatterns("[", { global: false });
    expect(invalid.ok).toBe(false);
    expect(filterPackages(packages, members, "[", true, invalid)).toBe(packages);
    expect(filterPackages(undefined, members, "total", true, null)).toBeUndefined();
    expect(groupPackageMembers(undefined).size).toBe(0);
  });

  test("reserves space for matching functions in the virtualized package list", () => {
    const filtered = filterPackages(packages, members, "pay", true, null)!;
    const measured = matchingMembersWindow(filtered)!;
    expect(measured.estimateSize(0)).toBeGreaterThan(measured.estimateSize(1));
    expect(measured.getItemKey(0)).not.toBe(measured.getItemKey(1));
    const withoutMembers = matchingMembersWindow(packages);
    expect(withoutMembers).toBeUndefined();
  });
});

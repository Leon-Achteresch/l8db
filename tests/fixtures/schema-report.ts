import type { CatalogObject } from "../../src/lib/db";
import { compareCatalogs } from "../../src/lib/schema-compare/diff";
import type { ReportExportState } from "../../src/lib/schema-compare/report-export";
import {
  type CompareResult,
  DEFAULT_COMPARE_OPTIONS,
  type DiffItem,
} from "../../src/lib/schema-compare/types";

export function reportItem(name = "amount"): DiffItem {
  const column = (type: string, nullable: string): CatalogObject => ({
    object_type: "column",
    name,
    parent: "orders",
    ddl: `${name} ${type}`,
    attributes: { type, nullable },
  });
  return compareCatalogs([column("numeric(12,2)", "NO")], [column("numeric(8,2)", "YES")], {
    kind: "postgres",
    sourceSchema: "dev",
    targetSchema: "prod",
    options: DEFAULT_COMPARE_OPTIONS,
  })[0];
}

export function reportResult(items: DiffItem[] = [reportItem()]): CompareResult {
  return {
    kind: "postgres",
    sourceSchema: "dev",
    targetSchema: "prod",
    options: { ...DEFAULT_COMPARE_OPTIONS },
    source: { connectionId: "dev", database: "app", schema: "dev" },
    target: { connectionId: "prod", database: "app", schema: "prod" },
    sourceLabel: "Development · app · dev",
    targetLabel: "Production · app · prod",
    comparedAt: "2026-11-16T20:00:00Z",
    types: ["table"],
    requestedTypes: ["table"],
    tableScope: { source: null, target: null },
    omitted: 0,
    items,
  };
}

export function reportState(result = reportResult()): ReportExportState {
  return {
    result,
    source: result.source,
    target: result.target,
    options: result.options,
    types: ["table"],
    selection: {},
    renames: {},
    loading: null,
    error: null,
  };
}

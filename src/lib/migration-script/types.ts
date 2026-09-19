import type { DatabaseKind } from "@/lib/db";
import type { SchemaSnapshot, SnapshotDiffEntry } from "@/lib/schema-snapshot";

export type MigrationStatementKind =
  | "create_table"
  | "add_column"
  | "alter_column"
  | "primary_key"
  | "drop_column"
  | "drop_table";

export interface MigrationStatement {
  id: string;
  kind: MigrationStatementKind;
  table: string;
  column: string | null;
  sql: string;
  dangerous: boolean;
  note: string | null;
}

export interface MigrationIssue {
  table: string;
  column: string | null;
  detail: string;
}

export interface MigrationScript {
  statements: MigrationStatement[];
  issues: MigrationIssue[];
  transactional: boolean;
  dangerousCount: number;
  skippedDangerous: number;
  sql: string;
}

export interface MigrationScriptInput {
  kind: DatabaseKind | null;
  base: SchemaSnapshot;
  current: SchemaSnapshot;
  entries: SnapshotDiffEntry[];
  includeDangerous?: boolean;
  generatedAt?: Date;
}

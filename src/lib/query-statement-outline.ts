import {
  type StatementSummary,
  splitSqlStatements,
  summarizeStatement,
} from "@/lib/sql-statements";

export interface StatementOutlineEntry {
  start: number;
  summary: StatementSummary;
  line: number;
  column: number;
}

class StatementOutlineItem implements StatementOutlineEntry {
  private cachedSummary: StatementSummary | null = null;

  constructor(
    private text: string,
    readonly start: number,
    readonly line: number,
    readonly column: number,
  ) {}

  get summarized() {
    return this.cachedSummary !== null;
  }

  get summary() {
    this.cachedSummary ??= summarizeStatement(this.text);
    return this.cachedSummary;
  }
}

export const OUTLINE_CACHE_LIMITS = {
  sqlCharacters: 1_000_000,
  entries: 4096,
} as const;

export class QueryStatementOutlineCache {
  private current: {
    sql: string;
    kind: string;
    entries: StatementOutlineItem[];
  } | null = null;

  get retainedEntries() {
    return this.current?.entries.length ?? 0;
  }

  get retainedSummaries() {
    return this.current?.entries.reduce((count, entry) => count + Number(entry.summarized), 0) ?? 0;
  }

  invalidate(sql: string, kind: string) {
    if (this.current && (this.current.sql !== sql || this.current.kind !== kind))
      this.current = null;
  }

  read(sql: string, kind: string): StatementOutlineEntry[] {
    this.invalidate(sql, kind);
    if (this.current) return this.current.entries;
    let line = 1;
    let lastNewline = -1;
    let nextNewline = sql.indexOf("\n");
    const entries = splitSqlStatements(sql, kind).statements.map((statement) => {
      while (nextNewline >= 0 && nextNewline < statement.start) {
        line++;
        lastNewline = nextNewline;
        nextNewline = sql.indexOf("\n", nextNewline + 1);
      }
      return new StatementOutlineItem(
        statement.text,
        statement.start,
        line,
        statement.start - lastNewline,
      );
    });
    if (
      sql.length <= OUTLINE_CACHE_LIMITS.sqlCharacters &&
      entries.length <= OUTLINE_CACHE_LIMITS.entries
    )
      this.current = { sql, kind, entries };
    return entries;
  }
}

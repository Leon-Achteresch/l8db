import { formatSqlWith } from "./sql-format";
import type { SqlFormatOptions } from "./sql-format-options";

self.onmessage = (event: MessageEvent<{ id: number; sql: string; options: SqlFormatOptions }>) => {
  const { id, sql, options } = event.data;
  self.postMessage({ id, result: formatSqlWith(sql, options) });
};

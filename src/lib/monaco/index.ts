import "./setup";
import "./languages";
import "./folding";
import "./themes";

export * as monaco from "monaco-editor/editor/editor.api";
export {
  activeConnectionKind,
  activeSqlDialect,
  addSqlFormatAction,
  formatSql,
  isSqlFormattingAvailable,
} from "./format";
export type { SqlErrorSource } from "./markers";
export { attachPlsqlLint, showSqlError } from "./markers";
export { overflowWidgetsDomNode } from "./overflow";

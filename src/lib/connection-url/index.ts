export { AUTH_FAILED_MESSAGE, connectionError, isAuthFailure, queryErrorMessage } from "./errors";
export {
  normalizeOracleHost,
  oracleConnectString,
  oracleKeyValueToUrl,
  updateOracleConnectionEndpoint,
} from "./oracle-endpoint";
export type { OracleKeyValue } from "./oracle-key-value";
export { isOracleKeyValue, parseOracleKeyValue } from "./oracle-key-value";
export {
  filePath,
  isTrustedConnection,
  kindFromUrl,
  parseConnectionUrl,
  sslModeFromUrl,
} from "./parse";
export { connectionSummary, detectProvider, providerFor } from "./summary";

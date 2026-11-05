export const ANY_SCHEMA_SQL =
  "SELECT COUNT(*) AS n FROM session_privs WHERE privilege = 'CREATE ANY TABLE'";

export function defaultTargetSchema(
  schema: string,
  sourceLogin: string | null,
  targetLogin: string | null,
  targetWritesAnySchema: boolean,
): string {
  return !targetWritesAnySchema &&
    sourceLogin &&
    targetLogin &&
    sourceLogin !== targetLogin &&
    schema === sourceLogin
    ? targetLogin
    : schema;
}

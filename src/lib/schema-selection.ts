import { connectionSummary } from "@/lib/connection-url";

export function oracleLoginSchema(connectionString: string, schemas: string[]): string | null {
  const user = connectionSummary(connectionString, "oracle").user;
  const login = /\[([^\]]+)\]$/.exec(user)?.[1] ?? user;
  return (
    schemas.find((schema) => schema === login) ??
    schemas.find((schema) => schema === login.toUpperCase()) ??
    null
  );
}

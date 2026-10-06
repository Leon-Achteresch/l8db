import type { DatabaseKind } from "@/lib/db";

export type CloudAuthMode = "password" | "aws_iam" | "entra";

export interface CloudAuth {
  mode: Exclude<CloudAuthMode, "password">;
  awsProfile?: string | null;
  awsRegion?: string | null;
  tenant?: string | null;
}

const CLOUD_AUTH_PARAMS = [
  "l8db_auth",
  "l8db_aws_profile",
  "l8db_aws_region",
  "l8db_tenant",
  "l8db_token_host",
  "l8db_token_port",
];

export function cloudAuthModes(kind: DatabaseKind): CloudAuthMode[] {
  if (kind === "postgres" || kind === "mysql") return ["password", "aws_iam", "entra"];
  if (kind === "mssql") return ["password", "entra"];
  return [];
}

export function activeCloudAuth(
  kind: DatabaseKind,
  cloudAuth: CloudAuth | null | undefined,
): CloudAuth | null {
  if (!cloudAuth || !cloudAuthModes(kind).includes(cloudAuth.mode)) return null;
  return cloudAuth;
}

export function cloudAuthConnectionString(
  value: string,
  connection: { kind: DatabaseKind; cloudAuth?: CloudAuth | null },
): string {
  const auth = activeCloudAuth(connection.kind, connection.cloudAuth);
  if (!auth && !value.includes("l8db_auth=")) return value;
  const query = value.indexOf("?");
  const base = query < 0 ? value : value.slice(0, query);
  const params = (query < 0 ? "" : value.slice(query + 1))
    .split("&")
    .filter((part) => part && !CLOUD_AUTH_PARAMS.includes(decodeURIComponent(part.split("=")[0])));
  if (auth) {
    const extra: [string, string | null | undefined][] = [
      ["l8db_auth", auth.mode],
      ["l8db_aws_profile", auth.mode === "aws_iam" ? auth.awsProfile?.trim() : null],
      ["l8db_aws_region", auth.mode === "aws_iam" ? auth.awsRegion?.trim() : null],
      ["l8db_tenant", auth.mode === "entra" ? auth.tenant?.trim() : null],
    ];
    try {
      const url = new URL(value);
      extra.push(["l8db_token_host", url.hostname.replace(/^\[|\]$/g, "")]);
      if (url.port) extra.push(["l8db_token_port", url.port]);
    } catch {}
    for (const [key, entry] of extra) {
      if (entry) params.push(`${key}=${encodeURIComponent(entry)}`);
    }
  }
  return params.length ? `${base}?${params.join("&")}` : base;
}

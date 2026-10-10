import type { ExternalConnection } from "./types";

export interface CloudTarget {
  connectionString: string;
  user: string;
  password: string | null;
  warnings: string[];
  credentialsMissing: boolean;
  skipReason: string | null;
}

const AWS_REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;

function param(connection: ExternalConnection, ...names: string[]): string {
  const wanted = names.map((name) => name.toLowerCase());
  for (const name of wanted) {
    const match = connection.params.find(([key]) => key.toLowerCase() === name);
    if (match?.[1].trim()) return match[1].trim();
  }
  return "";
}

function query(entries: Array<[string, string]>): string {
  const search = new URLSearchParams(entries.filter(([, value]) => value)).toString();
  return search ? `?${search}` : "";
}

function skip(reason: string): CloudTarget {
  return {
    connectionString: "",
    user: "",
    password: null,
    warnings: [],
    credentialsMissing: false,
    skipReason: reason,
  };
}

function regionFromHost(host: string): string {
  if (AWS_REGION.test(host)) return host;
  if (!AWS_HOST.test(host)) return "";
  return /(?:^|\.)([a-z]{2}(?:-gov)?-[a-z]+-\d)(?:\.|$)/.exec(host)?.[1] ?? "";
}

function awsRegion(connection: ExternalConnection, host = connection.host.toLowerCase()): string {
  const explicit = param(connection, "AwsRegion", "region");
  return explicit ? explicit.toLowerCase() : regionFromHost(host);
}

function awsCredentials(connection: ExternalConnection, warnings: string[]) {
  const profile = param(connection, "ProfileName", "profile", "AwsProfile");
  const user = connection.user || param(connection, "AccessKeyId", "UID");
  if (user && connection.password)
    return { user, password: connection.password, profile, missing: false };
  if (!profile)
    warnings.push(
      "Anmeldung ergänzen: Access Key oder AWS-Profil fehlt, sonst gilt die Standard-Anmeldekette.",
    );
  return { user: "", password: null, profile, missing: !profile };
}

function snowflake(connection: ExternalConnection): CloudTarget {
  const account = (param(connection, "account") || connection.host)
    .toLowerCase()
    .replace(/\.snowflakecomputing\.com$/, "");
  if (!account) return skip("Snowflake-Account fehlt.");
  const user = connection.user || param(connection, "user");
  const database = connection.database || param(connection, "db", "database");
  const schema = param(connection, "schema");
  const path = database
    ? `/${encodeURIComponent(database)}${schema ? `/${encodeURIComponent(schema)}` : ""}`
    : "";
  return {
    connectionString: `snowflake://${user ? `${encodeURIComponent(user)}@` : ""}${account}${path}${query(
      [
        ["warehouse", param(connection, "warehouse")],
        ["role", param(connection, "role")],
      ],
    )}`,
    user,
    password: null,
    warnings: [
      "Anmeldung ergänzen: Snowflake nutzt Key-Pair, Programmatic Access Token oder OAuth, Passwörter werden nicht übernommen.",
    ],
    credentialsMissing: true,
    skipReason: null,
  };
}

function bigquery(connection: ExternalConnection): CloudTarget {
  const project =
    param(connection, "ProjectId", "project", "project_id") ||
    (connection.host.includes(".") ? "" : connection.host) ||
    connection.database;
  if (!project) return skip("BigQuery-Projekt fehlt.");
  const dataset = param(connection, "DefaultDataset", "dataset");
  const keyFile = param(connection, "OAuthPvtKeyPath", "credentials_file", "key_file");
  const warnings = keyFile
    ? []
    : [
        "Anmeldung ergänzen: ohne Service-Account-Datei gelten die Application Default Credentials.",
      ];
  return {
    connectionString: `bigquery://${encodeURIComponent(project)}${dataset ? `/${encodeURIComponent(dataset)}` : ""}${query(
      [
        ["location", param(connection, "Location")],
        ["credentials_file", keyFile],
      ],
    )}`,
    user: "",
    password: null,
    warnings,
    credentialsMissing: !keyFile,
    skipReason: null,
  };
}

function athena(connection: ExternalConnection): CloudTarget {
  const region = awsRegion(connection);
  if (!region) return skip("AWS-Region für Athena fehlt.");
  const warnings: string[] = [];
  const credentials = awsCredentials(connection, warnings);
  const catalog = param(connection, "Catalog") || "AwsDataCatalog";
  return {
    connectionString: `athena://${credentials.user ? `${encodeURIComponent(credentials.user)}@` : ""}${region}/${encodeURIComponent(catalog)}${query(
      [
        ["workgroup", param(connection, "Workgroup", "WorkGroup")],
        ["output", param(connection, "S3OutputLocation", "output")],
        ["schema", param(connection, "Schema") || connection.database],
        ["profile", credentials.profile],
      ],
    )}`,
    user: credentials.user,
    password: credentials.password,
    warnings,
    credentialsMissing: credentials.missing,
    skipReason: null,
  };
}

const DEFAULT_REGION = "us-east-1";

const AWS_HOST = /(^|\.)(amazonaws\.com(\.cn)?|api\.aws)$/;

const STANDARD_DYNAMODB_HOST = /^dynamodb\.[a-z0-9-]+\.(amazonaws\.com(\.cn)?|api\.aws)$/;

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "dynamodb-local"];

const LOCAL_PORT = 8000;

export interface HostValue {
  scheme: "http" | "https" | null;
  host: string;
  port: number | null;
}

export function parseHostValue(value: string, port: number | null = null): HostValue {
  const trimmed = value.trim();
  const prefix = /^(https?):\/\//i.exec(trimmed);
  const authority = (prefix ? trimmed.slice(prefix[0].length) : trimmed).split(/[/?#]/)[0] ?? "";
  let host = authority;
  let parsedPort: number | null = null;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    host = end < 0 ? authority.slice(1) : authority.slice(1, end);
    const rest = end < 0 ? "" : authority.slice(end + 1);
    if (rest.startsWith(":")) parsedPort = Number(rest.slice(1)) || null;
  } else if (authority.split(":").length === 2) {
    const [name, rawPort] = authority.split(":");
    host = name;
    parsedPort = Number(rawPort) || null;
  }
  return {
    scheme: prefix ? (prefix[1].toLowerCase() as "http" | "https") : null,
    host: host.toLowerCase(),
    port: parsedPort ?? port,
  };
}

function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

interface DynamoTarget {
  endpoint: string;
  local: boolean;
  region: string;
}

function dynamoTarget(connection: ExternalConnection): DynamoTarget | string {
  const configured = param(connection, "endpoint", "Endpoint");
  if (configured && !/^https?:\/\//i.test(configured))
    return `Ungültiger DynamoDB-Endpunkt „${configured}“.`;
  const value = parseHostValue(configured || connection.host, configured ? null : connection.port);
  const aws = AWS_HOST.test(value.host);
  const standard =
    !value.host || AWS_REGION.test(value.host) || STANDARD_DYNAMODB_HOST.test(value.host);
  const scheme =
    value.scheme ??
    (connection.urlScheme === "https" ||
    ["true", "1"].includes(param(connection, "ssl", "tls").toLowerCase()) ||
    aws
      ? "https"
      : "http");
  const local =
    LOCAL_HOSTS.includes(value.host) ||
    value.host.endsWith(".local") ||
    (!aws && scheme === "http" && value.port === LOCAL_PORT);
  const derived = awsRegion(connection, value.host);
  const region = derived || (value.host && !aws ? DEFAULT_REGION : "");
  if (!region) return "AWS-Region für DynamoDB fehlt.";
  if (standard && !configured) return { endpoint: "", local: false, region };
  const port = value.port ?? (scheme === "http" && local ? LOCAL_PORT : null);
  return {
    endpoint: configured || `${scheme}://${hostForUrl(value.host)}${port ? `:${port}` : ""}`,
    local,
    region,
  };
}

function dynamodb(connection: ExternalConnection): CloudTarget {
  const target = dynamoTarget(connection);
  if (typeof target === "string") return skip(target);
  const warnings: string[] = [];
  const localDefaults = target.local && !(connection.user && connection.password);
  const credentials = localDefaults
    ? { user: connection.user || "local", password: "local", profile: "", missing: false }
    : awsCredentials(connection, warnings);
  if (
    target.endpoint &&
    !target.local &&
    !awsRegion(connection, parseHostValue(target.endpoint).host)
  )
    warnings.push(`Region prüfen: ohne Angabe in der Quelle gilt ${DEFAULT_REGION}.`);
  return {
    connectionString: `dynamodb://${credentials.user ? `${encodeURIComponent(credentials.user)}@` : ""}${target.region}${query(
      [
        ["profile", credentials.profile],
        ["endpoint", target.endpoint],
      ],
    )}`,
    user: credentials.user,
    password: credentials.password,
    warnings,
    credentialsMissing: credentials.missing,
    skipReason: null,
  };
}

export function cloudTarget(connection: ExternalConnection): CloudTarget {
  if (connection.kind === "snowflake") return snowflake(connection);
  if (connection.kind === "bigquery") return bigquery(connection);
  if (connection.kind === "athena") return athena(connection);
  return dynamodb(connection);
}

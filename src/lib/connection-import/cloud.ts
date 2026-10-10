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

function awsRegion(connection: ExternalConnection): string {
  const explicit = param(connection, "AwsRegion", "region");
  if (explicit) return explicit.toLowerCase();
  const host = connection.host.toLowerCase();
  if (AWS_REGION.test(host)) return host;
  if (!AWS_HOST.test(host)) return "";
  return /(?:^|\.)([a-z]{2}(?:-gov)?-[a-z]+-\d)(?:\.|$)/.exec(host)?.[1] ?? "";
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

const LOOPBACK = ["localhost", "127.0.0.1", "::1"];

interface DynamoEndpoint {
  url: string;
  loopback: boolean;
  defaultedRegion: boolean;
}

function dynamoHost(connection: ExternalConnection): string {
  return connection.host
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
}

function dynamoEndpoint(connection: ExternalConnection, region: string): DynamoEndpoint | null {
  const configured = param(connection, "endpoint", "Endpoint");
  const host = dynamoHost(connection);
  const loopback = LOOPBACK.includes(host) || host.endsWith(".local");
  if (configured)
    return /^https?:\/\//i.test(configured)
      ? { url: configured, loopback, defaultedRegion: !region }
      : null;
  if (!host || AWS_REGION.test(host) || STANDARD_DYNAMODB_HOST.test(host)) return null;
  const aws = AWS_HOST.test(host);
  const secure =
    connection.urlScheme === "https" ||
    ["true", "1"].includes(param(connection, "ssl", "tls").toLowerCase()) ||
    (aws && connection.urlScheme !== "http");
  const local = loopback || (!aws && !secure && connection.port === 8000);
  const port = connection.port ?? (!secure && local ? 8000 : null);
  const address = host.includes(":") ? `[${host}]` : host;
  return {
    url: `${secure ? "https" : "http"}://${address}${port ? `:${port}` : ""}`,
    loopback,
    defaultedRegion: !region,
  };
}

function dynamodb(connection: ExternalConnection): CloudTarget {
  const region = awsRegion(connection);
  const endpoint = dynamoEndpoint(connection, region);
  if (!region && !endpoint) return skip("AWS-Region für DynamoDB fehlt.");
  const warnings: string[] = [];
  const loopbackDefaults = endpoint?.loopback && !(connection.user && connection.password);
  const credentials = loopbackDefaults
    ? { user: connection.user || "local", password: "local", profile: "", missing: false }
    : awsCredentials(connection, warnings);
  if (endpoint?.defaultedRegion && !endpoint.loopback)
    warnings.push(`Region prüfen: ohne Angabe in der Quelle gilt ${DEFAULT_REGION}.`);
  return {
    connectionString: `dynamodb://${credentials.user ? `${encodeURIComponent(credentials.user)}@` : ""}${region || DEFAULT_REGION}${query(
      [
        ["profile", credentials.profile],
        ["endpoint", endpoint?.url ?? ""],
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

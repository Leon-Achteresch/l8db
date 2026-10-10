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
  return /\.([a-z]{2}(?:-gov)?-[a-z]+-\d)\.amazonaws\.com$/.exec(host)?.[1] ?? "";
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

const LOCAL_REGION = "us-east-1";

function localEndpoint(connection: ExternalConnection): string {
  const host = connection.host.trim().replace(/^https?:\/\//i, "");
  if (!host || /amazonaws\.com$/i.test(host) || AWS_REGION.test(host)) return "";
  const scheme = param(connection, "ssl", "tls").toLowerCase() === "true" ? "https" : "http";
  const address = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `${scheme}://${address}:${connection.port ?? 8000}`;
}

function dynamodbLocal(connection: ExternalConnection, endpoint: string): CloudTarget {
  const user = connection.user || "local";
  const password = connection.user && connection.password ? connection.password : "local";
  return {
    connectionString: `dynamodb://${encodeURIComponent(user)}@${LOCAL_REGION}${query([["endpoint", endpoint]])}`,
    user,
    password,
    warnings: [],
    credentialsMissing: false,
    skipReason: null,
  };
}

function dynamodb(connection: ExternalConnection): CloudTarget {
  const region = awsRegion(connection);
  const configured = param(connection, "endpoint", "Endpoint");
  const local = !region && !configured ? localEndpoint(connection) : "";
  const endpoint = configured || local;
  if (local) return dynamodbLocal(connection, local);
  if (!region) return skip("AWS-Region für DynamoDB fehlt.");
  const warnings: string[] = [];
  const credentials = awsCredentials(connection, warnings);
  return {
    connectionString: `dynamodb://${credentials.user ? `${encodeURIComponent(credentials.user)}@` : ""}${region}${query(
      [
        ["profile", credentials.profile],
        ["endpoint", /^https?:\/\//i.test(endpoint) ? endpoint : ""],
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

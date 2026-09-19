import anthropic from "thesvg/anthropic";
import auth0 from "thesvg/auth0";
import clerk from "thesvg/clerk";
import datadog from "thesvg/datadog";
import discord from "thesvg/discord";
import docker from "thesvg/docker";
import elasticsearch from "thesvg/elasticsearch";
import figma from "thesvg/figma";
import firebase from "thesvg/firebase";
import github from "thesvg/github";
import gitlab from "thesvg/gitlab";
import googleGemini from "thesvg/google-gemini";
import grafana from "thesvg/grafana";
import kafka from "thesvg/kafka";
import kubernetes from "thesvg/kubernetes";
import meilisearch from "thesvg/meilisearch";
import notion from "thesvg/notion";
import openai from "thesvg/openai";
import paypal from "thesvg/paypal";
import prisma from "thesvg/prisma";
import sentry from "thesvg/sentry";
import shopify from "thesvg/shopify";
import slack from "thesvg/slack";
import stripe from "thesvg/stripe";
import typesense from "thesvg/typesense";
import vercel from "thesvg/vercel";
import { thesvgSvgForSlug } from "../provider-logo/icons";

type IconModule = { svg: string };

const BRAND_ICONS: Record<string, IconModule> = {
  anthropic,
  auth0,
  clerk,
  datadog,
  discord,
  docker,
  elasticsearch,
  figma,
  firebase,
  github,
  gitlab,
  "google-gemini": googleGemini,
  grafana,
  kafka,
  kubernetes,
  meilisearch,
  notion,
  openai,
  paypal,
  prisma,
  sentry,
  shopify,
  slack,
  stripe,
  typesense,
  vercel,
};

const NAME_TO_BRAND: Record<string, string> = {
  openai: "openai",
  chatgpt: "openai",
  gpt: "openai",
  dalle: "openai",
  anthropic: "anthropic",
  claude: "anthropic",
  gemini: "google-gemini",
  googlegemini: "google-gemini",
  bard: "google-gemini",
  stripe: "stripe",
  github: "github",
  gitlab: "gitlab",
  shopify: "shopify",
  slack: "slack",
  discord: "discord",
  notion: "notion",
  figma: "figma",
  vercel: "vercel",
  firebase: "firebase",
  firestore: "firebase",
  prisma: "prisma",
  elastic: "elasticsearch",
  elasticsearch: "elasticsearch",
  meili: "meilisearch",
  meilisearch: "meilisearch",
  typesense: "typesense",
  kafka: "kafka",
  paypal: "paypal",
  auth0: "auth0",
  clerk: "clerk",
  sentry: "sentry",
  datadog: "datadog",
  grafana: "grafana",
  docker: "docker",
  kubernetes: "kubernetes",
  k8s: "kubernetes",
};

const NAME_TO_TECH: Record<string, string> = {
  pg: "postgresql",
  postgres: "postgresql",
  postgresql: "postgresql",
  postgis: "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  mongo: "mongodb",
  mongodb: "mongodb",
  redis: "redis",
  valkey: "valkey",
  keydb: "redis",
  dragonfly: "redis",
  sqlite: "sqlite",
  duckdb: "duckdb",
  clickhouse: "clickhouse",
  snowflake: "snowflake",
  bigquery: "google-bigquery",
  databricks: "databricks",
  supabase: "supabase",
  neon: "neon",
  planetscale: "planetscale",
  turso: "turso",
  libsql: "turso",
  tidb: "tidb",
  timescale: "timescale",
  timescaledb: "timescale",
  cockroach: "cockroach-labs",
  cockroachdb: "cockroach-labs",
  yugabyte: "yugabytedb",
  yugabytedb: "yugabytedb",
  scylla: "scylladb",
  scylladb: "scylladb",
  cassandra: "apache-cassandra",
  oracle: "oracle",
  mssql: "microsoft-sql-server",
  sqlserver: "microsoft-sql-server",
  trino: "trino",
  vitess: "vitess",
  crate: "cratedb",
  cratedb: "cratedb",
  singlestore: "singlestore",
  teradata: "teradata",
  sap: "sap",
  hana: "sap",
  db2: "ibm",
  informix: "ibm",
  netezza: "ibm",
  doris: "apache-doris",
  hive: "apache-hive",
  athena: "aws-amazon-athena",
  redshift: "aws-amazon-redshift",
  ferretdb: "ferretdb",
  documentdb: "aws-amazon-documentdb",
  cosmosdb: "azure-azure-cosmos-db",
};

export function candidateKeys(name: string): string[] {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (!base) return [];
  const keys = [base];
  for (const suffix of ["database", "db"]) {
    if (base.endsWith(suffix) && base.length > suffix.length + 1) {
      keys.push(base.slice(0, -suffix.length));
    }
  }
  return keys;
}

export function brandSvgForName(name: string): string | null {
  for (const key of candidateKeys(name)) {
    const slug = NAME_TO_BRAND[key];
    if (slug) {
      const icon = BRAND_ICONS[slug];
      if (icon) return icon.svg;
    }
    const tech = NAME_TO_TECH[key];
    if (tech) {
      const svg = thesvgSvgForSlug(tech);
      if (svg) return svg;
    }
  }
  return null;
}

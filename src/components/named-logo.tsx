import {
  Archive,
  Clock,
  CreditCard,
  Crown,
  Database,
  FileText,
  FlaskConical,
  Globe,
  HardDrive,
  Info,
  KeyRound,
  Layers,
  Lock,
  type LucideIcon,
  MapPin,
  Newspaper,
  Puzzle,
  Radio,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  Zap,
} from "lucide-react";
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
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ProviderLogo, ThesvgIcon, thesvgSvgForSlug } from "./provider-logo";

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

const NAME_TO_SYSTEM: Record<string, LucideIcon> = {
  public: Globe,
  private: Lock,
  auth: KeyRound,
  users: KeyRound,
  user: KeyRound,
  account: KeyRound,
  accounts: KeyRound,
  login: KeyRound,
  identity: KeyRound,
  storage: HardDrive,
  files: HardDrive,
  file: HardDrive,
  uploads: HardDrive,
  upload: HardDrive,
  media: HardDrive,
  assets: HardDrive,
  attachments: HardDrive,
  blobs: HardDrive,
  blob: HardDrive,
  extensions: Puzzle,
  extension: Puzzle,
  ext: Puzzle,
  realtime: Radio,
  vault: ShieldCheck,
  pgcatalog: Database,
  informationschema: Info,
  sys: Settings,
  system: Settings,
  dbo: Settings,
  analytics: TrendingUp,
  bi: TrendingUp,
  report: TrendingUp,
  reports: TrendingUp,
  reporting: TrendingUp,
  metric: TrendingUp,
  metrics: TrendingUp,
  stat: TrendingUp,
  stats: TrendingUp,
  warehouse: TrendingUp,
  mart: TrendingUp,
  lake: TrendingUp,
  gold: TrendingUp,
  silver: TrendingUp,
  bronze: TrendingUp,
  logs: FileText,
  log: FileText,
  logging: FileText,
  audit: FileText,
  event: FileText,
  events: FileText,
  test: FlaskConical,
  tests: FlaskConical,
  testing: FlaskConical,
  demo: FlaskConical,
  sample: FlaskConical,
  sandbox: FlaskConical,
  dev: FlaskConical,
  development: FlaskConical,
  qa: FlaskConical,
  prod: Rocket,
  production: Rocket,
  live: Rocket,
  main: Rocket,
  master: Rocket,
  primary: Rocket,
  backup: Archive,
  backups: Archive,
  archive: Archive,
  cache: Zap,
  temp: Zap,
  tmp: Zap,
  queue: Clock,
  queues: Clock,
  job: Clock,
  jobs: Clock,
  task: Clock,
  tasks: Clock,
  worker: Clock,
  cron: Clock,
  schedule: Clock,
  search: Search,
  billing: CreditCard,
  payment: CreditCard,
  payments: CreditCard,
  invoice: CreditCard,
  invoices: CreditCard,
  subscription: CreditCard,
  subscriptions: CreditCard,
  shop: Store,
  store: Store,
  commerce: Store,
  product: Store,
  products: Store,
  order: Store,
  orders: Store,
  customer: Store,
  customers: Store,
  cart: Store,
  checkout: Store,
  cms: Newspaper,
  content: Newspaper,
  blog: Newspaper,
  post: Newspaper,
  posts: Newspaper,
  page: Newspaper,
  pages: Newspaper,
  article: Newspaper,
  articles: Newspaper,
  news: Newspaper,
  geo: MapPin,
  location: MapPin,
  locations: MapPin,
  place: MapPin,
  places: MapPin,
  map: MapPin,
  maps: MapPin,
  ai: Sparkles,
  ml: Sparkles,
  embedding: Sparkles,
  embeddings: Sparkles,
  vector: Sparkles,
  vectors: Sparkles,
  llm: Sparkles,
  agent: Sparkles,
  agents: Sparkles,
  bot: Sparkles,
  chat: Sparkles,
  config: Settings,
  configs: Settings,
  setting: Settings,
  settings: Settings,
  option: Settings,
  options: Settings,
  admin: Crown,
  administrator: Crown,
  root: Crown,
};

function candidateKeys(name: string): string[] {
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

function brandSvgForName(name: string): string | null {
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

function SystemIconForName({ name, className }: { name: string; className?: string }) {
  for (const key of candidateKeys(name)) {
    const Icon = NAME_TO_SYSTEM[key];
    if (Icon)
      return (
        <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />
      );
  }
  return null;
}

export function SchemaLogo({ name, className }: { name: string; className?: string }) {
  const svg = brandSvgForName(name);
  if (svg) return <ThesvgIcon svg={svg} className={className} />;
  const system = SystemIconForName({ name, className });
  if (system) return system;
  return <Layers className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />;
}

export function DatabaseLogo({
  name,
  kind,
  providerId,
  className,
}: {
  name: string;
  kind?: DatabaseKind | null;
  providerId?: string | null;
  className?: string;
}) {
  const svg = brandSvgForName(name);
  if (svg) return <ThesvgIcon svg={svg} className={className} />;
  const system = SystemIconForName({ name, className });
  if (system) return system;
  if (providerId || kind)
    return <ProviderLogo providerId={providerId} kind={kind} className={className} />;
  return (
    <Database className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-hidden />
  );
}

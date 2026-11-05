import { invoke } from "./core";
import type { DatabaseKind, SslMode } from "./providers";

export type CloudProvider = "neon" | "planetscale" | "spacetimedb";
export type CloudAuthMethod = "api_key" | "oauth" | "service_token" | "token";

export interface CloudAccount {
  id: string;
  provider: CloudProvider;
  label: string;
  auth: CloudAuthMethod;
  endpoint: string | null;
  identity: string | null;
  created_at: string;
}

export interface CloudCreatedConnection {
  id: string;
  name: string;
  kind: string;
  provider_id: string;
  connection_string: string;
  ssl_mode: string;
}

export interface CloudPage<T> {
  items: T[];
  next_cursor: string | null;
}

export interface NeonOrganization {
  id: string;
  name: string;
  handle: string | null;
  plan: string | null;
}

export interface NeonProject {
  id: string;
  name: string;
  region_id: string | null;
  pg_version: number | null;
  org_id: string | null;
  created_at: string | null;
}

export interface NeonBranch {
  id: string;
  name: string;
  parent_id: string | null;
  current_state: string | null;
  default: boolean;
  protected: boolean;
  created_at: string | null;
}

export interface NeonDatabase {
  name: string;
  owner_name: string;
}

export interface NeonRole {
  name: string;
  protected: boolean;
}

export type NeonTransport = "tcp" | "neon-ws";

export interface NeonConnectionRequest {
  projectId: string;
  branchId: string;
  database: string;
  role: string;
  pooled: boolean;
  transport: NeonTransport;
  name: string;
}

export interface NeonAuthConfig {
  auth_provider: string;
  branch_id: string | null;
  db_name: string | null;
  created_at: string | null;
  owned_by: string | null;
  jwks_url: string | null;
  base_url: string | null;
  name: string | null;
}

export interface NeonAuthState {
  enabled: boolean;
  config: NeonAuthConfig | null;
}

export interface NeonAuthEnabled {
  base_url: string | null;
  jwks_url: string | null;
  schema_name: string | null;
  stored_keys: boolean;
}

export interface NeonAuthUser {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string | null;
  role: string | null;
  banned: boolean | null;
  email_verified: boolean | null;
}

export interface NeonAuthUsersPage {
  schema: "better_auth" | "stack";
  users: NeonAuthUser[];
  has_more: boolean;
}

export interface NeonStorage {
  enabled: boolean;
  s3_endpoint: string | null;
  region: string | null;
  force_path_style: boolean | null;
}

export interface NeonBucket {
  name: string;
  access_level: "private" | "public_read" | string | null;
  created_at: string | null;
}

export interface NeonObject {
  key: string;
  size: number | null;
  last_modified: string | null;
  etag: string | null;
}

export interface NeonObjectPage {
  folders: string[];
  objects: NeonObject[];
  prefix: string | null;
  next_cursor: string | null;
  is_truncated: boolean;
}

export interface NeonDeployment {
  id: number | string | null;
  status: string | null;
  memory_mib: number | null;
  runtime: string | null;
  created_at: string | null;
  error: string | null;
}

export interface NeonFunction {
  id: string;
  slug: string;
  name: string;
  invocation_url: string | null;
  current_deployment: NeonDeployment | null;
  active_deployment: NeonDeployment | null;
  created_at: string | null;
}

export interface NeonOAuthAvailability {
  available: boolean;
  reason: string | null;
}

export interface NeonOAuthStart {
  flow_id: string;
  authorize_url: string;
}

export interface PlanetScalePaged<T> {
  items: T[];
  next_page: number | null;
}

export interface PlanetScaleOrganization {
  id: string | null;
  name: string;
}

export interface PlanetScaleDatabase {
  id: string | null;
  name: string;
  kind: "mysql" | "postgresql" | "neki" | string;
  state: string | null;
  ready: boolean;
  default_branch: string | null;
  region: { slug: string | null; display_name: string | null } | null;
}

export interface PlanetScaleBranch {
  id: string | null;
  name: string;
  production: boolean;
  ready: boolean;
  created_at: string | null;
}

export interface PlanetScaleIssued {
  id: string;
  kind: "mysql" | "postgresql" | string;
  organization: string;
  database: string;
  branch: string;
  name: string;
  username: string;
  connection_id: string;
  created_at: string;
}

export interface PlanetScaleCredentialRequest {
  organization: string;
  database: string;
  branch: string;
  credentialName: string | null;
  connectionName: string;
  confirmed: boolean;
}

export interface PlanetScaleIssuedConnection {
  connection: CloudCreatedConnection;
  credential: PlanetScaleIssued;
}

export interface SpacetimeDatabase {
  identity: string;
  names: string[];
}

export interface SpacetimeDatabaseList {
  databases: SpacetimeDatabase[];
  truncated: boolean;
}

export interface SpacetimeColumn {
  name: string;
  type_name: string;
}

export interface SpacetimeTable {
  name: string;
  columns: SpacetimeColumn[];
  public: boolean;
  system: boolean;
  primary_key: string[];
}

export interface SpacetimeReducer {
  name: string;
  params: SpacetimeColumn[];
  lifecycle: string | null;
}

export interface SpacetimeSchema {
  tables: SpacetimeTable[];
  reducers: SpacetimeReducer[];
}

export interface SpacetimeReducerOutcome {
  status: number;
  message: string | null;
}

export const cloudAccounts = () => invoke<CloudAccount[]>("cloud_accounts");

export const cloudAccountRemove = (accountId: string, forgetIssued = false) =>
  invoke<void>("cloud_account_remove", { accountId, forgetIssued });

export const neonAddApiKey = (label: string, apiKey: string, endpoint?: string | null) =>
  invoke<CloudAccount>("cloud_neon_add_api_key", { label, apiKey, endpoint: endpoint || null });

export const neonOAuthConfig = () => invoke<NeonOAuthAvailability>("cloud_neon_oauth_config");

export const neonOAuthStart = (label: string) =>
  invoke<NeonOAuthStart>("cloud_neon_oauth_start", { label });

export const neonOAuthFinish = (flowId: string) =>
  invoke<CloudAccount>("cloud_neon_oauth_finish", { flowId });

export const neonOAuthCancel = (flowId: string) =>
  invoke<boolean>("cloud_neon_oauth_cancel", { flowId });

export const neonOrganizations = (accountId: string) =>
  invoke<NeonOrganization[]>("cloud_neon_organizations", { accountId });

export const neonProjects = (
  accountId: string,
  options: { orgId?: string | null; cursor?: string | null; search?: string | null } = {},
) =>
  invoke<CloudPage<NeonProject>>("cloud_neon_projects", {
    accountId,
    orgId: options.orgId || null,
    cursor: options.cursor || null,
    search: options.search?.trim() || null,
  });

export const neonBranches = (accountId: string, projectId: string, cursor?: string | null) =>
  invoke<CloudPage<NeonBranch>>("cloud_neon_branches", {
    accountId,
    projectId,
    cursor: cursor || null,
  });

export const neonDatabases = (accountId: string, projectId: string, branchId: string) =>
  invoke<NeonDatabase[]>("cloud_neon_databases", { accountId, projectId, branchId });

export const neonRoles = (accountId: string, projectId: string, branchId: string) =>
  invoke<NeonRole[]>("cloud_neon_roles", { accountId, projectId, branchId });

export const neonCreateConnection = (accountId: string, request: NeonConnectionRequest) =>
  invoke<CloudCreatedConnection>("cloud_neon_create_connection", { accountId, request });

export const neonAuth = (accountId: string, projectId: string, branchId: string) =>
  invoke<NeonAuthState>("cloud_neon_auth", { accountId, projectId, branchId });

export const neonAuthEnable = (
  accountId: string,
  projectId: string,
  branchId: string,
  database: string | null,
  confirmed: boolean,
) =>
  invoke<NeonAuthEnabled>("cloud_neon_auth_enable", {
    accountId,
    projectId,
    branchId,
    database,
    confirmed,
  });

export const neonAuthUsers = (
  accountId: string,
  projectId: string,
  branchId: string,
  offset: number,
  search?: string | null,
) =>
  invoke<NeonAuthUsersPage>("cloud_neon_auth_users", {
    accountId,
    projectId,
    branchId,
    offset,
    search: search?.trim() || null,
  });

export const neonAuthCreateUser = (
  accountId: string,
  projectId: string,
  branchId: string,
  email: string,
  name?: string | null,
) =>
  invoke<string>("cloud_neon_auth_create_user", {
    accountId,
    projectId,
    branchId,
    email,
    name: name?.trim() || null,
  });

export const neonAuthDeleteUser = (
  accountId: string,
  projectId: string,
  branchId: string,
  userId: string,
  confirmed: boolean,
) =>
  invoke<void>("cloud_neon_auth_delete_user", {
    accountId,
    projectId,
    branchId,
    userId,
    confirmed,
  });

export const neonAuthSetRoles = (
  accountId: string,
  projectId: string,
  branchId: string,
  userId: string,
  roles: string[],
) => invoke<void>("cloud_neon_auth_set_roles", { accountId, projectId, branchId, userId, roles });

export const neonStorage = (accountId: string, projectId: string, branchId: string) =>
  invoke<NeonStorage>("cloud_neon_storage", { accountId, projectId, branchId });

export const neonBuckets = (accountId: string, projectId: string, branchId: string) =>
  invoke<NeonBucket[]>("cloud_neon_buckets", { accountId, projectId, branchId });

export const neonCreateBucket = (
  accountId: string,
  projectId: string,
  branchId: string,
  name: string,
  publicRead: boolean,
) =>
  invoke<NeonBucket>("cloud_neon_create_bucket", {
    accountId,
    projectId,
    branchId,
    name,
    publicRead,
  });

export const neonObjects = (
  accountId: string,
  projectId: string,
  branchId: string,
  bucket: string,
  prefix?: string | null,
  cursor?: string | null,
) =>
  invoke<NeonObjectPage>("cloud_neon_objects", {
    accountId,
    projectId,
    branchId,
    bucket,
    prefix: prefix || null,
    cursor: cursor || null,
  });

export const neonFunctions = (
  accountId: string,
  projectId: string,
  branchId: string,
  cursor?: string | null,
) =>
  invoke<CloudPage<NeonFunction>>("cloud_neon_functions", {
    accountId,
    projectId,
    branchId,
    cursor: cursor || null,
  });

export const neonFunction = (
  accountId: string,
  projectId: string,
  branchId: string,
  slug: string,
) => invoke<NeonFunction>("cloud_neon_function", { accountId, projectId, branchId, slug });

export const planetScaleAddToken = (
  label: string,
  tokenId: string,
  token: string,
  endpoint?: string | null,
) =>
  invoke<CloudAccount>("cloud_planetscale_add_token", {
    label,
    tokenId,
    token,
    endpoint: endpoint || null,
  });

export const planetScaleOrganizations = (accountId: string, page?: number | null) =>
  invoke<PlanetScalePaged<PlanetScaleOrganization>>("cloud_planetscale_organizations", {
    accountId,
    page: page ?? null,
  });

export const planetScaleDatabases = (
  accountId: string,
  organization: string,
  page?: number | null,
) =>
  invoke<PlanetScalePaged<PlanetScaleDatabase>>("cloud_planetscale_databases", {
    accountId,
    organization,
    page: page ?? null,
  });

export const planetScaleBranches = (
  accountId: string,
  organization: string,
  database: string,
  page?: number | null,
) =>
  invoke<PlanetScalePaged<PlanetScaleBranch>>("cloud_planetscale_branches", {
    accountId,
    organization,
    database,
    page: page ?? null,
  });

export const planetScaleCreateCredential = (
  accountId: string,
  request: PlanetScaleCredentialRequest,
) =>
  invoke<PlanetScaleIssuedConnection>("cloud_planetscale_create_credential", {
    accountId,
    request,
  });

export const planetScaleCredentials = (accountId: string) =>
  invoke<PlanetScaleIssued[]>("cloud_planetscale_credentials", { accountId });

export const planetScaleRevokeCredential = (
  accountId: string,
  credentialId: string,
  confirmed: boolean,
) =>
  invoke<PlanetScaleIssued[]>("cloud_planetscale_revoke_credential", {
    accountId,
    credentialId,
    confirmed,
  });

export const spacetimeAdd = (
  label: string,
  token: string,
  endpoint?: string | null,
  identity?: string | null,
) =>
  invoke<CloudAccount>("cloud_spacetime_add", {
    label,
    token,
    endpoint: endpoint || null,
    identity: identity?.trim() || null,
  });

export const spacetimeDatabases = (accountId: string) =>
  invoke<SpacetimeDatabaseList>("cloud_spacetime_databases", { accountId });

export const spacetimeSchema = (accountId: string, database: string) =>
  invoke<SpacetimeSchema>("cloud_spacetime_schema", { accountId, database });

export const spacetimeCreateConnection = (accountId: string, database: string, name: string) =>
  invoke<CloudCreatedConnection>("cloud_spacetime_create_connection", {
    accountId,
    database,
    name,
  });

export const spacetimeCallReducer = (
  accountId: string,
  database: string,
  reducer: string,
  args: unknown[],
  confirmed: boolean,
) =>
  invoke<SpacetimeReducerOutcome>("cloud_spacetime_call_reducer", {
    accountId,
    database,
    reducer,
    args,
    confirmed,
  });

const SSL_MODES: readonly SslMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

export function savedConnectionFrom(created: CloudCreatedConnection) {
  const sslMode = (SSL_MODES as readonly string[]).includes(created.ssl_mode)
    ? (created.ssl_mode as SslMode)
    : "require";
  return {
    id: created.id,
    name: created.name,
    kind: created.kind as DatabaseKind,
    connectionString: created.connection_string,
    sslMode,
    tunnelPort: null,
    description: `Angelegt über Cloud-Konten (${created.provider_id})`,
  };
}

export const CLOUD_QUERY_OPTIONS = {
  staleTime: 60_000,
  gcTime: 0,
  retry: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchInterval: false,
} as const;

export const CLOUD_MAX_PAGES = 5;

export const CLOUD_INFINITE_QUERY_OPTIONS = {
  ...CLOUD_QUERY_OPTIONS,
  maxPages: CLOUD_MAX_PAGES,
} as const;

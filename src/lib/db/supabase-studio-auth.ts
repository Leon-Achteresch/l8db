import { invoke } from "./core";

export type SupabaseAuthUserFilter = "all" | "confirmed" | "unconfirmed" | "anonymous" | "banned";
export type SupabaseAuthUserSort =
  | "created_desc"
  | "created_asc"
  | "last_sign_in_desc"
  | "last_sign_in_asc"
  | "email_asc";
export type SupabaseAuthLinkType =
  | "signup"
  | "invite"
  | "magiclink"
  | "recovery"
  | "email_change_current"
  | "email_change_new";

export interface SupabaseStudioAuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  is_anonymous: boolean | null;
  banned_until: string | null;
  providers: string[];
}

export interface SupabaseStudioAuthUsersPage {
  users: SupabaseStudioAuthUser[];
  has_more: boolean;
  total: number | null;
  server_side: boolean;
}

export interface SupabaseAuthIdentity {
  identity_id?: string;
  id?: string;
  provider: string;
  email?: string;
  created_at?: string;
  last_sign_in_at?: string;
  updated_at?: string;
}

export interface SupabaseAuthFactor {
  id: string;
  friendly_name?: string;
  factor_type: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseAuthUserDetail {
  id: string;
  aud?: string;
  role?: string;
  email?: string;
  phone?: string;
  email_confirmed_at?: string;
  phone_confirmed_at?: string;
  confirmation_sent_at?: string;
  recovery_sent_at?: string;
  invited_at?: string;
  last_sign_in_at?: string;
  created_at?: string;
  updated_at?: string;
  banned_until?: string;
  deleted_at?: string;
  is_anonymous?: boolean;
  is_sso_user?: boolean;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  identities?: SupabaseAuthIdentity[];
  factors?: SupabaseAuthFactor[];
}

export interface SupabaseAuthUserAttributes {
  email?: string;
  phone?: string;
  password?: string;
  email_confirm?: boolean;
  phone_confirm?: boolean;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  ban_duration?: string;
  role?: string;
}

export interface SupabaseAuthLink {
  action_link: string | null;
  email_otp: string | null;
  hashed_token: string | null;
  verification_type: string | null;
  redirect_to: string | null;
}

export interface SupabaseAuthSettings {
  external?: Record<string, boolean>;
  disable_signup?: boolean;
  mailer_autoconfirm?: boolean;
  phone_autoconfirm?: boolean;
  sms_provider?: string;
  saml_enabled?: boolean;
  [key: string]: unknown;
}

export type SupabaseAuthConfig = Record<string, string | number | boolean | null>;

export const supabaseStudioAuthUsers = (
  reference: string,
  page: number,
  search: string,
  filter: SupabaseAuthUserFilter,
  sort: SupabaseAuthUserSort,
) =>
  invoke<SupabaseStudioAuthUsersPage>("supabase_studio_auth_users", {
    reference,
    page,
    search,
    filter,
    sort,
  });
export const supabaseStudioAuthUser = (reference: string, userId: string) =>
  invoke<SupabaseAuthUserDetail>("supabase_studio_auth_user", { reference, userId });
export const supabaseStudioAuthCreateUser = (
  reference: string,
  attributes: SupabaseAuthUserAttributes,
) => invoke<SupabaseAuthUserDetail>("supabase_studio_auth_create_user", { reference, attributes });
export const supabaseStudioAuthUpdateUser = (
  reference: string,
  userId: string,
  attributes: SupabaseAuthUserAttributes,
) =>
  invoke<SupabaseAuthUserDetail>("supabase_studio_auth_update_user", {
    reference,
    userId,
    attributes,
  });
export const supabaseStudioAuthSoftDeleteUser = (reference: string, userId: string) =>
  invoke<void>("supabase_studio_auth_soft_delete_user", { reference, userId });
export const supabaseStudioAuthInvite = (
  reference: string,
  email: string,
  redirectTo: string,
  data: Record<string, unknown> | null,
) =>
  invoke<SupabaseAuthUserDetail>("supabase_studio_auth_invite", {
    reference,
    email,
    redirectTo,
    data,
  });
export const supabaseStudioAuthGenerateLink = (
  reference: string,
  kind: SupabaseAuthLinkType,
  email: string,
  newEmail: string,
  password: string,
  redirectTo: string,
  data: Record<string, unknown> | null,
) =>
  invoke<SupabaseAuthLink>("supabase_studio_auth_generate_link", {
    reference,
    kind,
    email,
    newEmail,
    password,
    redirectTo,
    data,
  });
export const supabaseStudioAuthSignOutUser = (reference: string, userId: string) =>
  invoke<{ sessions: number; refresh_tokens: number }>("supabase_studio_auth_sign_out_user", {
    reference,
    userId,
  });
export const supabaseStudioAuthDeleteFactor = (
  reference: string,
  userId: string,
  factorId: string,
) => invoke<void>("supabase_studio_auth_delete_factor", { reference, userId, factorId });
export const supabaseStudioAuthSettings = (reference: string) =>
  invoke<SupabaseAuthSettings>("supabase_studio_auth_settings", { reference });
export const supabaseStudioAuthConfig = (reference: string) =>
  invoke<SupabaseAuthConfig>("supabase_studio_auth_config", { reference });
export const supabaseStudioAuthUpdateConfig = (reference: string, patch: SupabaseAuthConfig) =>
  invoke<SupabaseAuthConfig>("supabase_studio_auth_update_config", { reference, patch });

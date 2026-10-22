import { invoke } from "./core";

export interface SupabaseStudioCapabilities {
  self_hosted: boolean;
  sql: boolean;
  management: boolean;
  service_key: boolean;
  data_api: boolean;
}

export const supabaseStudioCapabilities = (reference: string) =>
  invoke<SupabaseStudioCapabilities>("supabase_studio_capabilities", { reference });

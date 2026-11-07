import { invoke } from "./core";

export interface JdbcJar {
  id: string;
  name: string;
  bytes: number;
}

export interface JdbcStatus {
  available: boolean;
  detail: string;
  jars: JdbcJar[];
  activeProcesses: number;
  maxProcesses: number;
  idleSeconds: number;
}

export interface JdbcProfile {
  id: string;
  name: string;
  driverClass: string;
  jars: string[];
  url: string;
  username: string;
  readOnly: boolean;
  hasPassword: boolean;
}

export interface JdbcProfileInput {
  id?: string;
  name: string;
  driverClass: string;
  jars: string[];
  url: string;
  username: string;
  readOnly: boolean;
  password: string | null;
}

export interface JdbcCatalogEntry {
  id: string;
  name: string;
  driverClass: string;
  urlTemplate: string;
  documentation: string;
}

export const jdbcStatus = () => invoke<JdbcStatus>("jdbc_status");
export const jdbcCatalog = () => invoke<JdbcCatalogEntry[]>("jdbc_catalog");
export const jdbcProfiles = () => invoke<JdbcProfile[]>("jdbc_profiles");
export const jdbcImportJar = () => invoke<JdbcJar | null>("jdbc_import_jar");
export const jdbcRemoveJar = (id: string) => invoke<void>("jdbc_remove_jar", { id });
export const jdbcSaveProfile = (input: JdbcProfileInput) =>
  invoke<JdbcProfile>("jdbc_save_profile", { input });
export const jdbcRemoveProfile = (id: string) => invoke<void>("jdbc_remove_profile", { id });
export const jdbcCloseProfile = (id: string) => invoke<void>("jdbc_close_profile", { id });

export function jdbcConnectionString(profileId: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profileId)) throw new Error("Ungültige JDBC-Profilkennung.");
  return `jdbc:l8db:${profileId}`;
}

import { invoke } from "./core";

export interface DbeaverWorkspace {
  data_sources_path: string;
  data_sources: string;
  credentials: string | null;
}

export interface ImportFile {
  name: string;
  path: string;
  text: string;
}

export function decryptNavicatLegacyPasswords(values: string[]): Promise<Array<string | null>> {
  return invoke<Array<string | null>>("decrypt_navicat_legacy_passwords", { values });
}

export function readDbeaverWorkspace(path: string): Promise<DbeaverWorkspace> {
  return invoke<DbeaverWorkspace>("read_dbeaver_workspace", { path });
}

export function detectDbeaverWorkspace(): Promise<DbeaverWorkspace | null> {
  return invoke<DbeaverWorkspace | null>("detect_dbeaver_workspace");
}

export function detectJetbrainsSshConfigs(): Promise<ImportFile[]> {
  return invoke<ImportFile[]>("detect_jetbrains_ssh_configs");
}

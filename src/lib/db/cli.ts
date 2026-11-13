import { invoke } from "@tauri-apps/api/core";

export type CliState = "ready" | "missing" | "not_on_path" | "other";

export interface CliStatus {
  installed: boolean;
  state: CliState;
  command: string;
  location: string | null;
  target: string;
}

export function cliStatus(): Promise<CliStatus> {
  return invoke("cli_status");
}

export function installCli(): Promise<CliStatus> {
  return invoke("cli_install");
}

export function uninstallCli(): Promise<CliStatus> {
  return invoke("cli_uninstall");
}

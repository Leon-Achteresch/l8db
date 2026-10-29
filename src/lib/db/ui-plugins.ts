import { invoke } from "./core";

export interface UiPluginFile {
  name: string;
  source: string;
  modified: number;
}

export interface UiPluginScan {
  dir: string;
  files: UiPluginFile[];
  skipped: { name: string; reason: string }[];
}

export type UiPluginSupportFile =
  | "AGENTS.md"
  | "CLAUDE.md"
  | "l8db-ui.d.ts"
  | "tsconfig.json"
  | ".status.json";

export const UI_PLUGINS_CHANGED_EVENT = "ui-plugins-changed";

export function scanUiPlugins(): Promise<UiPluginScan> {
  return invoke<UiPluginScan>("ui_plugins_scan");
}

export function writeUiPlugin(name: string, source: string): Promise<void> {
  return invoke<void>("ui_plugins_write", { name, source });
}

export function removeUiPlugin(name: string): Promise<void> {
  return invoke<void>("ui_plugins_remove", { name });
}

export function writeUiPluginSupport(name: UiPluginSupportFile, contents: string): Promise<void> {
  return invoke<void>("ui_plugins_write_support", { name, contents });
}

export function watchUiPlugins(): Promise<void> {
  return invoke<void>("ui_plugins_watch");
}

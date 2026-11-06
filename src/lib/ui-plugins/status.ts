import type { OptionSpec } from "./api";
import { useUiPluginSettings } from "./settings";
import { useUiPluginRuntime } from "./store";

export type UiPluginState = "active" | "disabled" | "error" | "stale";

export type UiPluginStatus = {
  file: string;
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  author?: string;
  state: UiPluginState;
  error?: { message: string; line?: number };
  slotErrors: Record<string, string>;
  tripped: Record<string, string>;
  runtimeError?: string;
  http: string[];
  granted: string[];
  options: Record<string, OptionSpec>;
};

type RuntimeSlice = Pick<
  ReturnType<typeof useUiPluginRuntime.getState>,
  "loaded" | "errors" | "slotErrors" | "tripped" | "runtimeErrors"
>;

type SettingsSlice = Pick<
  ReturnType<typeof useUiPluginSettings.getState>,
  "disabled" | "httpGrants"
>;

function forPlugin(record: Record<string, string>, id: string | undefined) {
  if (!id) return {};
  const prefix = `${id}:`;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => [key.slice(prefix.length), value]),
  );
}

export function uiPluginStatuses(runtime: RuntimeSlice, settings: SettingsSlice): UiPluginStatus[] {
  const files = [
    ...new Set([...Object.keys(runtime.loaded), ...Object.keys(runtime.errors)]),
  ].sort();
  return files.map((file) => {
    const plugin = runtime.loaded[file]?.definition;
    const error = runtime.errors[file];
    const state: UiPluginState = error
      ? plugin
        ? "stale"
        : "error"
      : plugin && settings.disabled.includes(plugin.id)
        ? "disabled"
        : "active";
    return {
      file,
      id: plugin?.id,
      name: plugin?.name,
      description: plugin?.description,
      version: plugin?.version,
      author: plugin?.author,
      state,
      error: error ? { message: error.message, line: error.line } : undefined,
      slotErrors: forPlugin(runtime.slotErrors, plugin?.id),
      tripped: forPlugin(runtime.tripped, plugin?.id),
      runtimeError: runtime.runtimeErrors[file],
      http: plugin?.http ?? [],
      granted: plugin ? (settings.httpGrants[plugin.id] ?? []) : [],
      options: plugin?.options ?? {},
    };
  });
}

export function uiPluginStatusReport() {
  const runtime = useUiPluginRuntime.getState();
  return {
    updatedAt: new Date().toISOString(),
    dir: runtime.dir,
    plugins: uiPluginStatuses(runtime, useUiPluginSettings.getState()).map(
      ({ options: _options, description: _description, ...status }) => status,
    ),
    skipped: runtime.skipped,
  };
}

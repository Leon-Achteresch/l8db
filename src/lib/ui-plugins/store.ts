import { create } from "zustand";
import type { PluginDefinition } from "./api";
import type { UiPluginRegistry } from "./registry";
import type { PluginTimers } from "./timers";

export type LoadedUiPlugin = {
  file: string;
  hash: string;
  definition: PluginDefinition;
  timers: PluginTimers;
};

export type UiPluginError = { message: string; line?: number; hash?: string };

interface UiPluginRuntimeState {
  ready: boolean;
  dir: string | null;
  loaded: Record<string, LoadedUiPlugin>;
  errors: Record<string, UiPluginError>;
  skipped: { name: string; reason: string }[];
  slotErrors: Record<string, string>;
  tripped: Record<string, string>;
  runtimeErrors: Record<string, string>;
  registry: UiPluginRegistry;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export const EMPTY_REGISTRY: UiPluginRegistry = {
  plugins: [],
  cell: null,
  rowTone: null,
  columns: null,
  toolbar: null,
  detailTabs: null,
  tabGroup: null,
  tabItem: null,
  closeButton: "auto",
  newTabPosition: "end",
  splitLayout: null,
  autoSaveGroups: true,
  templates: [],
  guards: [],
};

export const useUiPluginRuntime = create<UiPluginRuntimeState>()(() => ({
  ready: false,
  dir: null,
  loaded: {},
  errors: {},
  skipped: [],
  slotErrors: {},
  tripped: {},
  runtimeErrors: {},
  registry: EMPTY_REGISTRY,
}));

const queue: (() => void)[] = [];
let scheduled = false;
const listeners = new Set<() => void>();

export function onUiPluginFault(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function deferUiPluginUpdate(apply: () => void) {
  queue.push(apply);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const run of queue.splice(0)) run();
    for (const listener of listeners) listener();
  });
}

export function reportUiPluginRuntimeError(file: string, message: string) {
  deferUiPluginUpdate(() =>
    useUiPluginRuntime.setState((state) =>
      state.runtimeErrors[file] === message
        ? state
        : { runtimeErrors: { ...state.runtimeErrors, [file]: message } },
    ),
  );
}

export function reportUiPluginError(plugin: string, error: unknown) {
  const file = uiPluginRegistry().plugins.find((entry) => entry.id === plugin)?.file;
  if (file) reportUiPluginRuntimeError(file, errorMessage(error));
}

export function resetUiPluginFaults(id: string) {
  const prefix = `${id}:`;
  const keep = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)));
  useUiPluginRuntime.setState((state) => ({
    tripped: keep(state.tripped),
    slotErrors: keep(state.slotErrors),
  }));
}

export function useUiPluginRegistry<T>(select: (registry: UiPluginRegistry) => T): T {
  return useUiPluginRuntime((state) => select(state.registry));
}

export function uiPluginRegistry() {
  return useUiPluginRuntime.getState().registry;
}

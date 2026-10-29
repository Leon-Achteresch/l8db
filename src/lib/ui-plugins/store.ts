import { toast } from "sonner";
import { create } from "zustand";
import type { PluginDefinition } from "./api";
import { errorMessage, type SlotName } from "./guard";
import { buildRegistry, EMPTY_REGISTRY, slotKey, type UiPluginRegistry } from "./registry";
import { useUiPluginSettings } from "./settings";
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

function defer(apply: () => void) {
  queue.push(apply);
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const run of queue.splice(0)) run();
    for (const listener of listeners) listener();
  });
}

function recordSlotError(key: string, message: string) {
  defer(() =>
    useUiPluginRuntime.setState((state) =>
      state.slotErrors[key] === message
        ? state
        : { slotErrors: { ...state.slotErrors, [key]: message } },
    ),
  );
}

const events = {
  error(plugin: string, slot: SlotName, message: string) {
    recordSlotError(slotKey(plugin, slot), message);
  },
  trip(plugin: string, slot: SlotName, reason: string) {
    defer(() => {
      useUiPluginRuntime.setState((state) => ({
        tripped: { ...state.tripped, [slotKey(plugin, slot)]: reason },
      }));
      refreshUiPluginRegistry();
      toast.warning(`UI-Plugin ${plugin}: ${slot} wurde abgeschaltet`, { description: reason });
    });
  },
  slotsError(plugin: string, message: string) {
    recordSlotError(`${plugin}:slots`, message);
  },
};

export function reportUiPluginRuntimeError(file: string, message: string) {
  defer(() =>
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

export function refreshUiPluginRegistry() {
  const state = useUiPluginRuntime.getState();
  const settings = useUiPluginSettings.getState();
  const plugins = Object.values(state.loaded).sort((a, b) => (a.file < b.file ? -1 : 1));
  useUiPluginRuntime.setState({
    registry: buildRegistry({
      plugins,
      disabled: settings.disabled,
      options: settings.options,
      grants: settings.httpGrants,
      tripped: state.tripped,
      events,
    }),
  });
}

useUiPluginSettings.subscribe((state, previous) => {
  if (
    state.disabled === previous.disabled &&
    state.options === previous.options &&
    state.httpGrants === previous.httpGrants
  )
    return;
  for (const id of previous.disabled) if (!state.disabled.includes(id)) resetUiPluginFaults(id);
  refreshUiPluginRegistry();
});

export function useUiPluginRegistry<T>(select: (registry: UiPluginRegistry) => T): T {
  return useUiPluginRuntime((state) => select(state.registry));
}

export function uiPluginRegistry() {
  return useUiPluginRuntime.getState().registry;
}

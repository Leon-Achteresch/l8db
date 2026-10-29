import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { isMainWindow } from "@/lib/connections";
import {
  scanUiPlugins,
  UI_PLUGINS_CHANGED_EVENT,
  type UiPluginFile,
  watchUiPlugins,
  writeUiPluginSupport,
} from "@/lib/db";
import agentsGuide from "../../../packages/ui-plugin-api/folder-agents.md?raw";
import sdkTypes from "../../../packages/ui-plugin-api/l8db-ui.d.ts?raw";
import { evaluatePlugin } from "../../../packages/ui-plugin-api/src/evaluate";
import { validatePlugin } from "./api";
import type { SlotName } from "./guard";
import { buildRegistry, slotKey } from "./registry";
import { useUiPluginSettings } from "./settings";
import { uiPluginStatusReport } from "./status";
import {
  deferUiPluginUpdate,
  errorMessage,
  type LoadedUiPlugin,
  reportUiPluginRuntimeError,
  resetUiPluginFaults,
  type UiPluginError,
  useUiPluginRuntime,
} from "./store";
import { startTabPolicy } from "./tabs-policy";
import { createPluginTimers } from "./timers";

function recordSlotError(key: string, message: string) {
  deferUiPluginUpdate(() =>
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
    deferUiPluginUpdate(() => {
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

type Compiler = typeof import("../../../packages/ui-plugin-api/src/compile");

const TSCONFIG = `${JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      paths: { "@l8db/ui": ["./l8db-ui.d.ts"] },
    },
    include: ["*.ts", "*.tsx"],
  },
  null,
  2,
)}\n`;

let modules: Readonly<Record<string, unknown>> = {};
let running: Promise<void> | null = null;
let again = false;
let started = false;
let statusTimer: ReturnType<typeof setTimeout> | null = null;

export function hashSource(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16)}:${source.length}`;
}

function lineFromStack(error: unknown): number | undefined {
  const stack = error instanceof Error ? error.stack : undefined;
  const match = stack && /<anonymous>:(\d+):\d+/.exec(stack);
  const line = match ? Number(match[1]) - 3 : 0;
  return line > 0 ? line : undefined;
}

export function loadUiPlugin(
  compiler: Compiler,
  file: UiPluginFile,
  hash: string,
): { ok: true; plugin: LoadedUiPlugin } | { ok: false; error: UiPluginError } {
  const compiled = compiler.compilePlugin(file.source, file.name);
  if (!compiled.ok) return { ok: false, error: { ...compiled.error, hash } };
  const timers = createPluginTimers((error) =>
    reportUiPluginRuntimeError(file.name, errorMessage(error)),
  );
  try {
    const definition = validatePlugin(evaluatePlugin(compiled.code, modules, timers.globals));
    return { ok: true, plugin: { file: file.name, hash, definition, timers } };
  } catch (error) {
    timers.dispose();
    return { ok: false, error: { message: errorMessage(error), line: lineFromStack(error), hash } };
  }
}

export function applyUiPluginFiles(
  compiler: Compiler | null,
  files: readonly UiPluginFile[],
): { loaded: Record<string, LoadedUiPlugin>; errors: Record<string, UiPluginError> } {
  const state = useUiPluginRuntime.getState();
  const loaded = { ...state.loaded };
  const errors: Record<string, UiPluginError> = {};
  const present = new Set(files.map((file) => file.name));
  for (const name of Object.keys(loaded)) {
    if (present.has(name)) continue;
    loaded[name].timers.dispose();
    delete loaded[name];
  }
  for (const file of files) {
    const hash = hashSource(file.source);
    if (loaded[file.name]?.hash === hash) continue;
    const previous = state.errors[file.name];
    if (previous?.hash === hash) {
      errors[file.name] = previous;
      continue;
    }
    if (!compiler) continue;
    const result = loadUiPlugin(compiler, file, hash);
    if (!result.ok) {
      errors[file.name] = result.error;
      continue;
    }
    const replaced = loaded[file.name];
    replaced?.timers.dispose();
    loaded[file.name] = result.plugin;
    resetUiPluginFaults(result.plugin.definition.id);
    if (replaced && replaced.definition.id !== result.plugin.definition.id)
      resetUiPluginFaults(replaced.definition.id);
  }
  const owners = new Map<string, string>();
  for (const name of Object.keys(loaded).sort()) {
    const id = loaded[name].definition.id;
    const owner = owners.get(id);
    if (!owner) {
      owners.set(id, name);
      continue;
    }
    loaded[name].timers.dispose();
    errors[name] = { message: `id "${id}" wird schon in ${owner} verwendet.`, hash: "" };
    delete loaded[name];
  }
  return { loaded, errors };
}

export async function checkUiPluginSource(file: string, source: string, expectedId?: string) {
  const compiler = await import("../../../packages/ui-plugin-api/src/compile");
  const result = loadUiPlugin(compiler, { name: file, source, modified: 0 }, hashSource(source));
  if (!result.ok)
    throw new Error(
      result.error.line
        ? `Zeile ${result.error.line}: ${result.error.message}`
        : result.error.message,
    );
  result.plugin.timers.dispose();
  if (expectedId && result.plugin.definition.id !== expectedId)
    throw new Error(`Plugin meldet id "${result.plugin.definition.id}", erwartet "${expectedId}".`);
  return result.plugin.definition;
}

function scheduleStatus() {
  if (!isMainWindow || statusTimer) return;
  statusTimer = setTimeout(() => {
    statusTimer = null;
    const report = uiPluginStatusReport();
    void writeUiPluginSupport(".status.json", `${JSON.stringify(report, null, 2)}\n`).catch(
      () => undefined,
    );
  }, 250);
}

async function reloadOnce() {
  const scan = await scanUiPlugins();
  const files = Array.isArray(scan?.files) ? scan.files : [];
  const compiler = files.length
    ? await import("../../../packages/ui-plugin-api/src/compile")
    : null;
  const previous = useUiPluginRuntime.getState();
  const { loaded, errors } = applyUiPluginFiles(compiler, files);
  const runtimeErrors = Object.fromEntries(
    Object.entries(previous.runtimeErrors).filter(
      ([file]) => loaded[file] && loaded[file] === previous.loaded[file],
    ),
  );
  useUiPluginRuntime.setState({
    ready: true,
    dir: scan?.dir ?? null,
    loaded,
    errors,
    skipped: Array.isArray(scan?.skipped) ? scan.skipped : [],
    runtimeErrors,
  });
  refreshUiPluginRegistry();
  scheduleStatus();
}

export function reloadUiPlugins(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await reloadOnce();
      } catch (error) {
        console.warn("UI-Plugins konnten nicht geladen werden", error);
        useUiPluginRuntime.setState({ ready: true });
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

async function writeSupportFiles() {
  await writeUiPluginSupport("AGENTS.md", agentsGuide);
  await writeUiPluginSupport("CLAUDE.md", "@AGENTS.md\n");
  await writeUiPluginSupport("l8db-ui.d.ts", sdkTypes);
  await writeUiPluginSupport("tsconfig.json", TSCONFIG);
}

export async function startUiPluginHost(sdkModules: Readonly<Record<string, unknown>>) {
  if (started) return;
  started = true;
  modules = sdkModules;
  startTabPolicy();
  useUiPluginRuntime.subscribe((state, previous) => {
    if (
      state.registry !== previous.registry ||
      state.slotErrors !== previous.slotErrors ||
      state.tripped !== previous.tripped ||
      state.runtimeErrors !== previous.runtimeErrors
    )
      scheduleStatus();
  });
  useUiPluginSettings.subscribe(() => scheduleStatus());
  await listen(UI_PLUGINS_CHANGED_EVENT, () => void reloadUiPlugins()).catch(() => undefined);
  await reloadUiPlugins();
  void watchUiPlugins().catch((error) =>
    console.warn("UI-Plugin-Ordner wird nicht beobachtet", error),
  );
  if (isMainWindow) void writeSupportFiles().catch(() => undefined);
}

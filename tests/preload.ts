import childProcess from "node:child_process";
import { mock } from "bun:test";
import * as tauriCore from "@tauri-apps/api/core";

if (typeof window === "undefined") {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage } });
}

const retainedChildProcesses: unknown[] = [];
const spawnChildProcess = childProcess.spawn;
childProcess.spawn = ((...args: Parameters<typeof spawnChildProcess>) => {
  const child = spawnChildProcess(...args);
  retainedChildProcesses.push(child, ...child.stdio);
  return child;
}) as typeof spawnChildProcess;

const realTauriCore = { ...tauriCore };
const mockModule = mock.module.bind(mock);
mock.module = ((specifier: string, factory: () => unknown) => {
  if (specifier !== "@tauri-apps/api/core") return mockModule(specifier, factory);
  return mockModule(specifier, () => {
    const mocked = factory();
    return mocked instanceof Promise
      ? mocked.then((value) => ({ ...realTauriCore, ...value }))
      : { ...realTauriCore, ...(mocked as object) };
  });
}) as typeof mock.module;

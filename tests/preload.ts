import childProcess from "node:child_process";

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

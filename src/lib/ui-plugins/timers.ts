export type PluginTimers = ReturnType<typeof createPluginTimers>;

export function createPluginTimers(report: (error: unknown) => void) {
  const timeouts = new Set<ReturnType<typeof setTimeout>>();
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const frames = new Set<number>();
  let disposed = false;
  const guard =
    (callback: unknown, done?: () => void) =>
    (...args: unknown[]) => {
      done?.();
      if (disposed || typeof callback !== "function") return;
      try {
        callback(...args);
      } catch (error) {
        report(error);
      }
    };
  const globals = {
    setTimeout: (callback: unknown, delay?: number, ...args: unknown[]) => {
      if (disposed) return 0 as unknown as ReturnType<typeof setTimeout>;
      const id: ReturnType<typeof setTimeout> = setTimeout(
        guard(callback, () => timeouts.delete(id)),
        delay,
        ...args,
      );
      timeouts.add(id);
      return id;
    },
    clearTimeout: (id: ReturnType<typeof setTimeout>) => {
      if (timeouts.delete(id)) clearTimeout(id);
    },
    setInterval: (callback: unknown, delay?: number, ...args: unknown[]) => {
      if (disposed) return 0 as unknown as ReturnType<typeof setInterval>;
      const id = setInterval(guard(callback), Math.max(16, delay ?? 0), ...args);
      intervals.add(id);
      return id;
    },
    clearInterval: (id: ReturnType<typeof setInterval>) => {
      if (intervals.delete(id)) clearInterval(id);
    },
    requestAnimationFrame: (callback: unknown) => {
      if (disposed) return 0;
      const id: number = requestAnimationFrame(guard(callback, () => frames.delete(id)));
      frames.add(id);
      return id;
    },
    cancelAnimationFrame: (id: number) => {
      if (frames.delete(id)) cancelAnimationFrame(id);
    },
  };
  return {
    globals,
    get disposed() {
      return disposed;
    },
    get active() {
      return timeouts.size + intervals.size + frames.size;
    },
    dispose() {
      disposed = true;
      for (const id of timeouts) clearTimeout(id);
      for (const id of intervals) clearInterval(id);
      for (const id of frames) cancelAnimationFrame(id);
      timeouts.clear();
      intervals.clear();
      frames.clear();
    },
  };
}

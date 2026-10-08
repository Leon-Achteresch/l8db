const slots = new Map<string, { running: number; waiting: (() => void)[] }>();

export async function withQuerySlot<T>(
  key: string,
  limit: number,
  signal: AbortSignal,
  run: () => Promise<T>,
): Promise<T> {
  if (limit <= 0) return run();
  signal.throwIfAborted();
  const own = slots.get(key) ?? { running: 0, waiting: [] };
  slots.set(key, own);
  if (own.running < limit) own.running++;
  else
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", drop);
        resolve();
      };
      const drop = () => {
        own.waiting.splice(own.waiting.indexOf(start), 1);
        reject(signal.reason);
      };
      own.waiting.push(start);
      signal.addEventListener("abort", drop, { once: true });
    });
  try {
    return await run();
  } finally {
    const next = own.waiting.shift();
    if (next) next();
    else own.running--;
  }
}

const PLUGIN_ERROR = Symbol.for("l8db.ui-plugin-error");

export function markPluginError(error: unknown): unknown {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as PromiseLike<unknown>).then === "function"
  )
    return error;
  const marked =
    error instanceof Error && !Object.isFrozen(error)
      ? error
      : new Error(String(error), { cause: error });
  if (!Object.hasOwn(marked, PLUGIN_ERROR))
    Object.defineProperty(marked, PLUGIN_ERROR, { value: true });
  return marked;
}

export function isPluginError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  return Object.hasOwn(error, PLUGIN_ERROR) || isPluginError((error as { cause?: unknown }).cause);
}

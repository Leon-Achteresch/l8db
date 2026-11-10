export const GUARD_NAME = "__l8dbExecutionGuard";
export const EXECUTION_LIMIT_MS = 100;
export const EXECUTION_ERROR = "UI-Plugin: Laufzeitgrenze überschritten";

export function createExecutionGuard() {
  const now = performance.now.bind(performance);
  let depth = 0;
  let deadline = 0;
  let failed = false;
  const resume = () => {
    if (depth === 0) deadline = now() + EXECUTION_LIMIT_MS;
    depth++;
  };
  const check = () => {
    if (failed || now() > deadline || depth > 256) {
      failed = true;
      throw new Error(EXECUTION_ERROR);
    }
  };
  return Object.freeze({
    enter() {
      if (depth === 0) deadline = now() + EXECUTION_LIMIT_MS;
      depth++;
      try {
        check();
      } catch (error) {
        depth--;
        throw error;
      }
    },
    check,
    size(value: unknown) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000)
        throw new RangeError("UI-Plugin: Allokationsgrenze überschritten");
      return value;
    },
    leave() {
      if (depth > 0) depth--;
    },
    suspend(value: unknown) {
      if (depth > 0) depth--;
      return Promise.resolve(value).then(
        (result) => {
          resume();
          return result;
        },
        (error) => {
          resume();
          throw error;
        },
      );
    },
  });
}

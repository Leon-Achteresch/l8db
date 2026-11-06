export const BLOCKED_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "portal",
  "template",
]);

export function checkPluginElement(type: unknown, props: unknown) {
  if (typeof type !== "string") return;
  if (BLOCKED_ELEMENTS.has(type.toLowerCase()))
    throw new Error(`<${type}> ist in UI-Plugins nicht erlaubt.`);
  if (props && typeof props === "object") {
    if ("dangerouslySetInnerHTML" in props)
      throw new Error("dangerouslySetInnerHTML ist in UI-Plugins nicht erlaubt.");
    if ("ref" in props && (props as { ref?: unknown }).ref != null)
      throw new Error("ref auf HTML-Elemente ist in UI-Plugins nicht erlaubt.");
  }
}

const EVENT_METHODS = [
  "preventDefault",
  "stopPropagation",
  "isDefaultPrevented",
  "isPropagationStopped",
  "getModifierState",
] as const;

const TARGET_FIELDS = [
  "value",
  "checked",
  "name",
  "type",
  "id",
  "tagName",
  "selectedIndex",
  "selectionStart",
  "selectionEnd",
  "scrollTop",
  "scrollLeft",
  "scrollHeight",
  "scrollWidth",
  "clientHeight",
  "clientWidth",
] as const;

const EVENT_HANDLER = /^on[A-Z]/;

const handlers = new WeakMap<(...args: unknown[]) => unknown, (...args: unknown[]) => void>();

function isPrimitive(value: unknown) {
  return value === null || (typeof value !== "object" && typeof value !== "function");
}

function targetSnapshot(target: unknown) {
  if (target === null || typeof target !== "object") return undefined;
  const source = target as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of TARGET_FIELDS) if (isPrimitive(source[key])) copy[key] = source[key];
  if (source.dataset && typeof source.dataset === "object")
    copy.dataset = Object.freeze({ ...(source.dataset as Record<string, string>) });
  return Object.freeze(copy);
}

export function pluginEvent(event: unknown): unknown {
  if (event === null || typeof event !== "object") return event;
  const source = event as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key in source) if (isPrimitive(source[key])) copy[key] = source[key];
  for (const name of EVENT_METHODS) {
    const method = source[name];
    if (typeof method !== "function") continue;
    copy[name] = (...args: unknown[]) => {
      const result = method.apply(
        source,
        args.map((arg) => (isPrimitive(arg) ? arg : undefined)),
      );
      return isPrimitive(result) ? result : undefined;
    };
  }
  copy.target = targetSnapshot(source.target);
  copy.currentTarget = targetSnapshot(source.currentTarget);
  return Object.freeze(copy);
}

function pluginHandler(handler: (...args: unknown[]) => unknown) {
  let wrapped = handlers.get(handler);
  if (!wrapped) {
    wrapped = (...args: unknown[]) => {
      handler(...args.map(pluginEvent));
    };
    handlers.set(handler, wrapped);
  }
  return wrapped;
}

export function pluginElementProps(type: unknown, props: unknown): unknown {
  checkPluginElement(type, props);
  if (typeof type !== "string" || props === null || typeof props !== "object") return props;
  const source = props as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const key in source) {
    const value = source[key];
    if (typeof value !== "function") continue;
    if (!EVENT_HANDLER.test(key)) throw new Error(`${key} darf in UI-Plugins keine Funktion sein.`);
    next ??= { ...source };
    next[key] = pluginHandler(value as (...args: unknown[]) => unknown);
  }
  return next ?? props;
}

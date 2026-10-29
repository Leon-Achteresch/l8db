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

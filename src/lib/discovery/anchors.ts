export const FEATURE_ATTRIBUTE = "data-feature";

export function featureAnchor(id: string): { "data-feature": string } {
  return { "data-feature": id };
}

export function featureSelector(id: string): string {
  return `[${FEATURE_ATTRIBUTE}="${id.replace(/["\\]/g, "\\$&")}"]`;
}

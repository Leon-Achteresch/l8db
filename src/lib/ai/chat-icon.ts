import type { IconNode } from "lucide";

const NAME = /^[a-z][a-z0-9-]{0,47}$/;
let catalog: Promise<Record<string, IconNode>> | undefined;

function icons() {
  catalog ??= import("lucide/dist/esm/iconsAndAliases.mjs").then(
    (module: Record<string, IconNode>) => module,
    (error) => {
      catalog = undefined;
      throw error;
    },
  );
  return catalog;
}

export function lucideExportName(name: string) {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export async function loadLucideIcon(name: string): Promise<IconNode | null> {
  if (!NAME.test(name) || name.includes("--") || name.endsWith("-")) return null;
  return (await icons())[lucideExportName(name)] ?? null;
}

export async function lucideIconExists(name: string) {
  return (await loadLucideIcon(name)) !== null;
}

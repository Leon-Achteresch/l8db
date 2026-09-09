import * as React from "react";

export function selectItemText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(selectItemText).join(" ");
  if (React.isValidElement(node))
    return selectItemText((node.props as { children?: React.ReactNode }).children);
  return "";
}

export function matchesSelectSearch(
  node: React.ReactNode,
  value: string | undefined,
  query: string,
): boolean {
  if (!query) return true;
  return `${selectItemText(node)} ${value ?? ""}`.toLowerCase().includes(query);
}

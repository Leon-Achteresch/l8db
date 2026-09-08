import { createContext, useContext, useEffect, useReducer } from "react";
import type { ExtensionManager } from "./manager";
export const ExtensionHostContext = createContext<ExtensionManager | null>(null);
export function useExtensionHost() {
  const host = useContext(ExtensionHostContext);
  if (!host) throw new Error("Extension host provider is missing");
  return host;
}
export function useExtensionSnapshot<T>(selector: (manager: ExtensionManager) => T): T {
  const manager = useExtensionHost();
  const [, force] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    const subscription = manager.changes.on("change", () => force());
    return () => subscription.dispose();
  }, [manager]);
  return selector(manager);
}
export function useExtensionCommands() {
  return useExtensionSnapshot((manager) => manager.commands.list());
}
export function useExtensionViews() {
  return useExtensionSnapshot((manager) => manager.listViews());
}
export function useExtensionStatusBar() {
  return useExtensionSnapshot((manager) => manager.listStatusBar());
}
export function useExtensionPanels() {
  return useExtensionSnapshot((manager) => manager.listPanels());
}

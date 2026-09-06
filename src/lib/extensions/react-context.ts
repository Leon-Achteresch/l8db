import { createContext, useContext } from "react";
import type { ExtensionManager } from "./manager";
export const ExtensionHostContext = createContext<ExtensionManager | null>(null);
export function useExtensionHost() {
  const host = useContext(ExtensionHostContext);
  if (!host) throw new Error("Extension host provider is missing");
  return host;
}

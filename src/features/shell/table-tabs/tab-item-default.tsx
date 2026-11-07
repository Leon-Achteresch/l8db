import { createContext, type ReactNode, useContext } from "react";

export const TabItemDefaultContent = createContext<ReactNode>(null);

export function TabItemDefault() {
  return <>{useContext(TabItemDefaultContent)}</>;
}

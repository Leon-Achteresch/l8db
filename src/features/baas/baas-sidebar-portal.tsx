import { createContext, type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";

export const BaasSidebarSlot = createContext<HTMLElement | null>(null);

export function BaasSidebarPortal({ children }: { children: ReactNode }) {
  const slot = useContext(BaasSidebarSlot);
  return slot ? createPortal(children, slot) : null;
}

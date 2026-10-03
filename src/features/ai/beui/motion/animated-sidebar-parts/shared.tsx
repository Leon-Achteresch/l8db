import type { HTMLMotionProps, Variants } from "motion/react";
import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useSyncExternalStore,
} from "react";
import { EASE_DRAWER, EASE_OUT } from "@/features/ai/beui/lib/ease";
export type SidebarState = "expanded" | "collapsed";
export type SidebarSide = "left" | "right";
export type SidebarVariant = "sidebar" | "floating" | "inset";
export type SidebarCollapsible = "offcanvas" | "icon" | "none";
export const MOBILE_QUERY = "(max-width: 767px)";
export const SIDEBAR_KEYBOARD_SHORTCUT = "b";
export const PANEL_TRANSITION = {
  duration: 0.36,
  ease: EASE_DRAWER,
} as const;
export const SIDEBAR_MORPH_TRANSITION = {
  type: "spring",
  stiffness: 380,
  damping: 35,
  mass: 0.75,
} as const;
export const LABEL_ENTER_TRANSITION = {
  duration: 0.2,
  delay: 0.08,
  ease: EASE_OUT,
} as const;
export const LABEL_EXIT_TRANSITION = {
  duration: 0.12,
  ease: EASE_OUT,
} as const;
export const SUBMENU_TRANSITION = {
  duration: 0.18,
  ease: EASE_OUT,
} as const;
export const SUBMENU_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    clipPath: "inset(0 0 100% 0 round 8px)",
    transition: {
      duration: 0.14,
      ease: EASE_OUT,
      staggerChildren: 0.025,
      staggerDirection: -1,
    },
  },
  open: {
    opacity: 1,
    clipPath: "inset(0 0 0% 0 round 8px)",
    transition: {
      duration: 0.2,
      delayChildren: 0.035,
      ease: EASE_OUT,
      staggerChildren: 0.045,
    },
  },
};
export const SUBMENU_ITEM_VARIANTS: Variants = {
  closed: {
    opacity: 0,
    y: -6,
    filter: "blur(3px)",
  },
  open: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: SUBMENU_TRANSITION,
  },
};
export const REDUCED_TRANSITION = {
  duration: 0.16,
  ease: EASE_OUT,
} as const;
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
export function subscribeToMobileQuery(callback: () => void) {
  const query = window.matchMedia(MOBILE_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}
export function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}
export function getServerMobileSnapshot() {
  return false;
}
export function useIsMobile() {
  return useSyncExternalStore(subscribeToMobileQuery, getMobileSnapshot, getServerMobileSnapshot);
}
export interface AnimatedSidebarContextValue {
  isMobile: boolean;
  layoutId: string;
  open: boolean;
  openMobile: boolean;
  reduce: boolean;
  setOpen: (open: boolean) => void;
  setOpenMobile: (open: boolean) => void;
  state: SidebarState;
  toggleSidebar: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}
export const AnimatedSidebarContext = createContext<AnimatedSidebarContextValue | null>(null);
export interface AnimatedSidebarPanelContextValue {
  collapsed: boolean;
  collapsible: SidebarCollapsible;
  side: SidebarSide;
}
export const AnimatedSidebarPanelContext = createContext<AnimatedSidebarPanelContextValue | null>(
  null,
);
export function useAnimatedSidebar() {
  const context = useContext(AnimatedSidebarContext);
  if (!context) {
    throw new Error("useAnimatedSidebar must be used inside AnimatedSidebarProvider.");
  }
  return context;
}
export function useAnimatedSidebarPanel() {
  const context = useContext(AnimatedSidebarPanelContext);
  if (!context) {
    throw new Error("Animated Sidebar parts must be used inside AnimatedSidebar.");
  }
  return context;
}
export type SidebarProviderStyle = CSSProperties & {
  "--sidebar-width"?: string;
  "--sidebar-width-icon"?: string;
  "--sidebar-width-mobile"?: string;
};
export interface AnimatedSidebarProviderProps extends HTMLAttributes<HTMLDivElement> {
  keyboardShortcut?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  openMobile?: boolean;
  defaultOpenMobile?: boolean;
  onOpenMobileChange?: (open: boolean) => void;
  style?: SidebarProviderStyle;
}
export interface AnimatedSidebarProps extends Omit<HTMLMotionProps<"aside">, "children"> {
  children?: ReactNode;
  side?: SidebarSide;
  variant?: SidebarVariant;
  collapsible?: SidebarCollapsible;
  ariaLabel?: string;
  panelClassName?: string;
}
export interface AnimatedSidebarTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {}
export interface AnimatedSidebarCloseProps extends ButtonHTMLAttributes<HTMLButtonElement> {}
export interface AnimatedSidebarRailProps extends ButtonHTMLAttributes<HTMLButtonElement> {}
export interface AnimatedSidebarInsetProps extends HTMLMotionProps<"main"> {}
export interface AnimatedSidebarMenuSubProps extends Omit<HTMLMotionProps<"ul">, "children"> {
  open: boolean;
  children?: ReactNode;
}
export interface AnimatedSidebarMenuSubButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  href?: string;
  isActive?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
  onSelect?: () => void;
  className?: string;
}
export interface AnimatedSidebarMenuButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  href?: string;
  isActive?: boolean;
  ariaExpanded?: boolean;
  disabled?: boolean;
  closeOnSelect?: boolean;
  target?: "_blank" | "_self" | "_parent" | "_top";
  rel?: string;
  onSelect?: () => void;
  className?: string;
}
export { AnimatedSidebar } from "./animated-sidebar";
export { AnimatedSidebarClose } from "./animated-sidebar-close";
export { AnimatedSidebarContent } from "./animated-sidebar-content";
export { AnimatedSidebarFooter } from "./animated-sidebar-footer";
export { AnimatedSidebarGroup } from "./animated-sidebar-group";
export { AnimatedSidebarGroupContent } from "./animated-sidebar-group-content";
export { AnimatedSidebarGroupLabel } from "./animated-sidebar-group-label";
export { AnimatedSidebarHeader } from "./animated-sidebar-header";
export { AnimatedSidebarInset } from "./animated-sidebar-inset";
export { AnimatedSidebarMenu } from "./animated-sidebar-menu";
export { AnimatedSidebarMenuItem } from "./animated-sidebar-menu-item";
export { AnimatedSidebarMenuSub } from "./animated-sidebar-menu-sub";
export { AnimatedSidebarMenuSubItem } from "./animated-sidebar-menu-sub-item";
export { AnimatedSidebarRail } from "./animated-sidebar-rail";
export { AnimatedSidebarTrigger } from "./animated-sidebar-trigger";

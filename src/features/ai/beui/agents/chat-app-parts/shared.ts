import type { AnimatedSidebarProviderProps } from "@/features/ai/beui/motion/animated-sidebar";
export const MIN_DOCKED_WIDTH = 600;
export interface ChatAppProps extends AnimatedSidebarProviderProps {
  sidebarWidth?: string;
  collapseSidebarBelow?: number;
}

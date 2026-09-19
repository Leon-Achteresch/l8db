import type { ReactNode } from "react";

export type PullToRefreshStatus = "idle" | "pulling" | "ready" | "refreshing";

export interface PullToRefreshProps {
  /** Runs after the user pulls beyond the threshold and releases. */
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
  /** Keeps the indicator active while an externally managed refresh runs. */
  refreshing?: boolean;
  disabled?: boolean;
  /** Resisted pull distance in pixels required to refresh. */
  threshold?: number;
  /** Maximum resisted pull distance in pixels. */
  maxPull?: number;
  /** Content offset in pixels while refreshing. */
  holdDistance?: number;
  pullingLabel?: ReactNode;
  releaseLabel?: ReactNode;
  refreshingLabel?: ReactNode;
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
  indicatorClassName?: string;
}

export type Gesture = {
  active: boolean;
  startX: number;
  startY: number;
  pointerId: number | null;
};

export const EMPTY_GESTURE: Gesture = {
  active: false,
  startX: 0,
  startY: 0,
  pointerId: null,
};

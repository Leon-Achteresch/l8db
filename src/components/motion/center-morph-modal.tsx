"use client";
// beui.dev/components/motion/center-morph-modal

import { type ReactNode, useCallback, useId, useMemo, useState } from "react";
import {
  CenterMorphModalContext,
  type CenterMorphModalContextValue,
} from "./center-morph-modal/context";

export { CenterMorphModalClose, type CenterMorphModalCloseProps } from "./center-morph-modal/close";
export {
  CenterMorphModalContent,
  type CenterMorphModalContentProps,
} from "./center-morph-modal/content";
export {
  CenterMorphModalTrigger,
  type CenterMorphModalTriggerProps,
} from "./center-morph-modal/trigger";

export interface CenterMorphModalProps {
  children: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Initial state when used uncontrolled. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * A modal whose full-size surface unfolds outward from its exact center.
 * Supports controlled and uncontrolled state through composable primitives.
 */
export function CenterMorphModal({
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
}: CenterMorphModalProps) {
  const id = useId();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const value = useMemo<CenterMorphModalContextValue>(
    () => ({
      open,
      setOpen,
      triggerId: `${id}-trigger`,
      contentId: `${id}-content`,
    }),
    [id, open, setOpen],
  );

  return (
    <CenterMorphModalContext.Provider value={value}>{children}</CenterMorphModalContext.Provider>
  );
}

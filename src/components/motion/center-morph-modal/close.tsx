"use client";

import { cloneElement, isValidElement, type ReactElement } from "react";
import { useCenterMorphModalContext } from "./context";

export interface CenterMorphModalCloseProps {
  children: ReactElement;
}

/** Wraps one interactive element and closes the modal. */
export function CenterMorphModalClose({ children }: CenterMorphModalCloseProps) {
  const context = useCenterMorphModalContext("CenterMorphModalClose");
  if (!isValidElement(children)) return children;

  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child.props.onClick as
    | ((event: React.MouseEvent<HTMLElement>) => void)
    | undefined;

  return cloneElement(child, {
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      childOnClick?.(event);
      if (!event.defaultPrevented) context.setOpen(false);
    },
  });
}

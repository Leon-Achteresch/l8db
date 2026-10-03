import { cloneElement, isValidElement, type ReactElement, type Ref, useMemo } from "react";
import { type MorphPopoverTriggerProps, mergeRefs, useMorphContext } from "./shared";

export function MorphPopoverTrigger({ children }: MorphPopoverTriggerProps) {
  const ctx = useMorphContext("MorphPopoverTrigger");
  const child = children as ReactElement<Record<string, unknown>>;
  const childOnClick = child?.props?.onClick as ((e: unknown) => void) | undefined;
  const childRef = (
    child?.props as
      | {
          ref?: Ref<HTMLElement>;
        }
      | undefined
  )?.ref;
  const mergedRef = useMemo(
    () => mergeRefs(childRef, ctx.registerTrigger),
    [childRef, ctx.registerTrigger],
  );
  if (!isValidElement(children)) return children;
  return cloneElement(child, {
    id: ctx.triggerId,
    ref: mergedRef,
    onClick: (e: unknown) => {
      childOnClick?.(e);
      ctx.toggle();
    },
    "aria-haspopup": "dialog",
    "aria-expanded": ctx.open,
    "aria-controls": ctx.open ? ctx.contentId : undefined,
  });
}

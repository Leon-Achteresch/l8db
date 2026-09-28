import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  useVirtualizer,
  Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";
import { startTransition, useEffect, useLayoutEffect, useReducer, useState } from "react";
import { IS_CHROMIUM } from "@/lib/platform";

const useIsomorphicLayoutEffect = typeof document === "undefined" ? useEffect : useLayoutEffect;

export function useTransitionVirtualizer<
  TScrollElement extends Element,
  TItemElement extends Element,
>(
  options: PartialKeys<
    VirtualizerOptions<TScrollElement, TItemElement>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  > & { useFlushSync?: boolean },
): Virtualizer<TScrollElement, TItemElement> {
  const rerender = useReducer((value: number) => value + 1, 0)[1];
  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, sync) => {
      startTransition(rerender);
      options.onChange?.(instance, sync);
    },
  };
  const [instance] = useState(() => new Virtualizer<TScrollElement, TItemElement>(resolvedOptions));
  instance.setOptions(resolvedOptions);
  useIsomorphicLayoutEffect(() => instance._didMount(), []);
  useIsomorphicLayoutEffect(() => instance._willUpdate());
  return instance;
}

export const useGridVirtualizer = IS_CHROMIUM ? useTransitionVirtualizer : useVirtualizer;

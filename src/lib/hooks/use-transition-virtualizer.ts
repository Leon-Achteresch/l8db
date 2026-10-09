import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type PartialKeys,
  useVirtualizer,
  type VirtualItem,
  Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/react-virtual";
import { startTransition, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
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
  const snapshot = useRef<{
    items: VirtualItem[];
    width: number | undefined;
    height: number | undefined;
    totalSize: number;
    isScrolling: boolean;
  } | null>(null);
  const resolvedOptions: VirtualizerOptions<TScrollElement, TItemElement> = {
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    ...options,
    onChange: (instance, sync) => {
      options.onChange?.(instance, sync);
      const next = {
        items: instance.getVirtualItems(),
        width: instance.scrollRect?.width,
        height: instance.scrollRect?.height,
        totalSize: instance.getTotalSize(),
        isScrolling: instance.isScrolling,
      };
      const previous = snapshot.current;
      if (
        previous?.items === next.items &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.totalSize === next.totalSize &&
        previous.isScrolling === next.isScrolling
      )
        return;
      snapshot.current = next;
      startTransition(rerender);
    },
  };
  const [instance] = useState(() => new Virtualizer<TScrollElement, TItemElement>(resolvedOptions));
  instance.setOptions(resolvedOptions);
  useIsomorphicLayoutEffect(() => instance._didMount(), []);
  useIsomorphicLayoutEffect(() => instance._willUpdate());
  return instance;
}

export const useGridVirtualizer = IS_CHROMIUM ? useTransitionVirtualizer : useVirtualizer;

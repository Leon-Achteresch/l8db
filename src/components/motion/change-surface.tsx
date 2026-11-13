import { type ReactNode, useLayoutEffect, useRef } from "react";
import { animateChange, type ChangeAnimation } from "@/lib/change-animation";

interface Props {
  changeKey: string;
  kind?: ChangeAnimation;
  className?: string;
  children: ReactNode;
  order?: number;
}

export function ChangeSurface({ changeKey, kind = "view", className, children, order }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const previousOrder = useRef(order);

  useLayoutEffect(() => {
    const direction =
      order !== undefined && previousOrder.current !== undefined && order < previousOrder.current
        ? -1
        : 1;
    previousOrder.current = order;
    if (ref.current && changeKey) return animateChange(ref.current, kind, direction);
  }, [changeKey, kind, order]);

  return (
    <div ref={ref} data-slot="change-surface" className={className}>
      {children}
    </div>
  );
}

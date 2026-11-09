import { type ReactNode, useLayoutEffect, useRef } from "react";
import { animateChange, type ChangeAnimation } from "@/lib/change-animation";

interface Props {
  changeKey: string;
  kind?: ChangeAnimation;
  className?: string;
  children: ReactNode;
}

export function ChangeSurface({ changeKey, kind = "view", className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ref.current && changeKey) return animateChange(ref.current, kind);
  }, [changeKey, kind]);

  return (
    <div ref={ref} data-slot="change-surface" className={className}>
      {children}
    </div>
  );
}

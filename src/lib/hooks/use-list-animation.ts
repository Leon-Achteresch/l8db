import { useAutoAnimate } from "@formkit/auto-animate/react";
import { EASE_OUT_CSS } from "@/lib/ease";

export function useListAnimation<T extends HTMLElement>() {
  const [ref] = useAutoAnimate<T>({ duration: 200, easing: EASE_OUT_CSS });
  return ref;
}

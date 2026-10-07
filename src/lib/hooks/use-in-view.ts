import { type RefObject, useEffect, useState } from "react";

export function useInView(
  ref: RefObject<Element | null>,
  root: Element | null,
  rootMargin: string,
) {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.at(-1)?.isIntersecting ?? false),
      { root, rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, root, rootMargin]);
  return inView;
}

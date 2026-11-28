import { type Ref, useCallback, useState } from "react";

export function useMenuArrowContainer(ref?: Ref<HTMLDivElement>) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      setContainer(node?.parentElement ?? null);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  return [container, attach] as const;
}

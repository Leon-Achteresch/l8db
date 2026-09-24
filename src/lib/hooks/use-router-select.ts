import { type RegisteredRouter, type RouterState, useRouter } from "@tanstack/react-router";
import { startTransition, useEffect, useReducer, useRef } from "react";

type State = RouterState<RegisteredRouter["routeTree"]>;
type Subscribable = { subscribe: (listener: () => void) => { unsubscribe: () => void } };

export function useRouterSelect<T>(select: (state: State) => T): T {
  const router = useRouter();
  const value = select(router.state);
  const latest = useRef({ select, value });
  latest.current = { select, value };
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const check = () => {
      const { select, value } = latest.current;
      if (!Object.is(select(router.state), value)) startTransition(rerender);
    };
    check();
    return (router.stores.__store as unknown as Subscribable).subscribe(check).unsubscribe;
  }, [router]);
  return value;
}

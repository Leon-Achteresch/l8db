import { useRouterState } from "@tanstack/react-router";

export function useRouteActive(routeId: string, params: Record<string, string>): boolean {
  return useRouterState({
    select: (state) =>
      state.matches.some(
        (match) =>
          match.routeId === routeId &&
          Object.entries(params).every(
            ([key, value]) => (match.params as Record<string, string>)[key] === value,
          ),
      ),
  });
}

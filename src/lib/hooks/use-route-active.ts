import { useRouterSelect } from "@/lib/hooks/use-router-select";

export function useRouteActive(routeId: string, params: Record<string, string>): boolean {
  return useRouterSelect((state) =>
    state.matches.some(
      (match) =>
        match.routeId === routeId &&
        Object.entries(params).every(
          ([key, value]) => (match.params as Record<string, string>)[key] === value,
        ),
    ),
  );
}

import type { router } from "@/router";

type AppRouter = typeof router;

let current: AppRouter | null = null;

export function setAppRouter(next: AppRouter) {
  current = next;
}

export function appRouter(): AppRouter | null {
  return current;
}

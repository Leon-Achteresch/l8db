import { createFileRoute } from "@tanstack/react-router";

import { HomeView } from "@/features/home/home-view";

export const Route = createFileRoute("/_app/_workspace/")({
  component: HomeView,
});

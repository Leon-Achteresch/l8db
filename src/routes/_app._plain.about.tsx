import { createFileRoute } from "@tanstack/react-router";

import { AboutView } from "@/features/about/about-view";

export const Route = createFileRoute("/_app/_plain/about")({
  component: AboutView,
});

import { createFileRoute } from "@tanstack/react-router";
import { BaasView } from "@/features/baas/baas-view";

export const Route = createFileRoute("/baas")({
  component: BaasView,
});

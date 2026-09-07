import { createFileRoute } from "@tanstack/react-router";
import { PlainLayout } from "@/features/shell/plain-layout";

export const Route = createFileRoute("/_app/_plain")({
  component: PlainLayout,
});

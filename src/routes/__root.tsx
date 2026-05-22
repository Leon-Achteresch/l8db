import { createRootRoute } from "@tanstack/react-router";
import "../index.css";
import { AppLayout } from "../layouts/AppLayout";

export const Route = createRootRoute({
  component: AppLayout,
});

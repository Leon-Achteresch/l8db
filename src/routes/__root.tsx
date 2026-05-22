import { createRootRoute } from "@tanstack/react-router";
import "../index.css";
import { RootLayout } from "../layouts/RootLayout";

export const Route = createRootRoute({
  component: RootLayout,
});

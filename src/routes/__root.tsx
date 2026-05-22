import { createRootRoute } from "@tanstack/react-router";
import "../App.css";
import { RootLayout } from "../layouts/RootLayout";

export const Route = createRootRoute({
  component: RootLayout,
});

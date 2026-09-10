import { createRootRoute, Outlet } from "@tanstack/react-router";
import "../index.css";

function RootComponent() {
  return <Outlet />;
}

export const Route = createRootRoute({
  component: RootComponent,
});

import { createFileRoute } from "@tanstack/react-router";
import { ConnectionsPage } from "../pages/ConnectionsPage";

export const Route = createFileRoute("/connections")({
  component: ConnectionsPage,
});

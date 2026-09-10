import { createFileRoute } from "@tanstack/react-router";
import { ERDiagramPage } from "../pages/ERDiagramPage";

export const Route = createFileRoute("/_app/er-diagram")({
  component: ERDiagramPage,
});

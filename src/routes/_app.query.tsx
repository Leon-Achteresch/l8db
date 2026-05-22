import { createFileRoute } from "@tanstack/react-router";
import { QueryPage } from "../pages/QueryPage";

export const Route = createFileRoute("/_app/query")({
  component: QueryPage,
});

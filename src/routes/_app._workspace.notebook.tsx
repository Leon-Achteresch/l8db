import { createFileRoute } from "@tanstack/react-router";

import { NotebookView } from "@/features/notebook/notebook-view";

export const Route = createFileRoute("/_app/_workspace/notebook")({
  component: NotebookView,
});

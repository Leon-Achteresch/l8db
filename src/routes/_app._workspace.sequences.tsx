import { createFileRoute } from "@tanstack/react-router";

import { SequencesView } from "@/features/sequences/sequences-view";

export const Route = createFileRoute("/_app/_workspace/sequences")({
  component: SequencesView,
});

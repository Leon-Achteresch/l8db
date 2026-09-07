import { createFileRoute } from "@tanstack/react-router";

import { ReleaseNotesView } from "@/features/updates/release-notes-view";

export const Route = createFileRoute("/release-notes")({
  component: ReleaseNotesView,
});

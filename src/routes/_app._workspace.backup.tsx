import { createFileRoute } from "@tanstack/react-router";

import { BackupView } from "@/features/backup/backup-view";

export const Route = createFileRoute("/_app/_workspace/backup")({
  component: BackupView,
});

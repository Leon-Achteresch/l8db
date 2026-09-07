import { createFileRoute } from "@tanstack/react-router";

import { ReplicationView } from "@/features/replication/replication-view";

export const Route = createFileRoute("/_app/_workspace/replication")({
  component: ReplicationView,
});

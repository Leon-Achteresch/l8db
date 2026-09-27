import { createFileRoute } from "@tanstack/react-router";

import { TransferView } from "@/features/transfer/transfer-view";

export const Route = createFileRoute("/_app/_workspace/transfer")({
  component: TransferView,
});

import { createFileRoute } from "@tanstack/react-router";

import { UsersView } from "@/features/users/users-view";

export const Route = createFileRoute("/_app/_workspace/users/$name")({
  component: UsersView,
});

import { createFileRoute } from "@tanstack/react-router";

import { UsersView } from "@/features/users/users-view";

export const Route = createFileRoute("/_app/_workspace/users/$name")({
  component: function UsersRoute() {
    const { name } = Route.useParams();
    return <UsersView name={name} />;
  },
});

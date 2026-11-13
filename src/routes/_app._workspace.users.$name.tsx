import { createFileRoute } from "@tanstack/react-router";

import { UsersView } from "@/features/users/users-view";

export const Route = createFileRoute("/_app/_workspace/users/$name")({
  component: function UsersRoute() {
    const { name } = Route.useParams();
    const { profile } = Route.useSearch();
    return <UsersView name={name} profile={profile} />;
  },
  validateSearch: (search: Record<string, unknown>): { profile?: boolean } => ({
    profile: search["profile"] === true ? true : undefined,
  }),
});

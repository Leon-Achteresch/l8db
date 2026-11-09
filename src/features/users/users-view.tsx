import { PrincipalView } from "@/features/users/principal-view/principal-view";
import { RoleView } from "@/features/users/role-view";
import { useActiveConnection } from "@/lib/connections";
import { supports } from "@/lib/providers";

export function UsersView({ name, profile }: { name: string; profile?: boolean }) {
  const connection = useActiveConnection();
  if (supports(connection, "principals")) return <PrincipalView name={name} profile={profile} />;
  return <RoleView name={name} />;
}

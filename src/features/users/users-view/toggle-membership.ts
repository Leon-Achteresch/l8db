import type { EditFormState } from "@/features/users/users-view/types";

export function toggleMembershipState(editState: EditFormState, roleName: string): EditFormState {
  const isCurrent = editState.current_member_of.includes(roleName);
  const isGranted = editState.grant_roles.includes(roleName);
  const isRevoked = editState.revoke_roles.includes(roleName);

  if (isCurrent) {
    if (isRevoked) {
      return {
        ...editState,
        revoke_roles: editState.revoke_roles.filter((r) => r !== roleName),
        current_member_of: [...editState.current_member_of],
      };
    } else {
      return {
        ...editState,
        revoke_roles: [...editState.revoke_roles, roleName],
      };
    }
  } else {
    if (isGranted) {
      return {
        ...editState,
        grant_roles: editState.grant_roles.filter((r) => r !== roleName),
      };
    } else {
      return {
        ...editState,
        grant_roles: [...editState.grant_roles, roleName],
      };
    }
  }
}

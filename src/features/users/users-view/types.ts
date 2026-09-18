export interface EditFormState {
  superuser: boolean;
  can_login: boolean;
  create_db: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: string;
  valid_until: string;
  password: string;
  grant_roles: string[];
  revoke_roles: string[];
  current_member_of: string[];
}

export interface CreateFormState {
  name: string;
  password: string;
  superuser: boolean;
  can_login: boolean;
  create_db: boolean;
  create_role: boolean;
  replication: boolean;
  bypass_rls: boolean;
  conn_limit: string;
  valid_until: string;
  member_of: string[];
}

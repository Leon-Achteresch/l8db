use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Principal {
    pub name: String,
    pub kind: String,
    pub status: Option<String>,
    pub system: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrincipalList {
    pub items: Vec<Principal>,
    pub limited: bool,
    pub current_user: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct RoleGrant {
    pub name: String,
    pub admin: bool,
    pub default: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct SystemGrant {
    pub name: String,
    pub admin: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ObjectGrant {
    pub owner: String,
    pub object: String,
    pub object_type: String,
    pub privilege: String,
    pub column: Option<String>,
    pub grantable: bool,
    pub grantor: String,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Quota {
    pub tablespace: String,
    pub bytes: i64,
    pub max_bytes: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Member {
    pub name: String,
    pub admin: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ProfileLimit {
    pub resource: String,
    pub kind: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrincipalDetail {
    pub name: String,
    pub kind: String,
    pub system: bool,
    pub limited: bool,
    pub status: Option<String>,
    pub locked: bool,
    pub expired: bool,
    pub lock_date: Option<String>,
    pub expiry_date: Option<String>,
    pub created: Option<String>,
    pub last_login: Option<String>,
    pub default_tablespace: Option<String>,
    pub temporary_tablespace: Option<String>,
    pub profile: Option<String>,
    pub authentication: Option<String>,
    pub roles: Vec<RoleGrant>,
    pub system_privileges: Vec<SystemGrant>,
    pub object_privileges: Vec<ObjectGrant>,
    pub object_privileges_truncated: bool,
    pub quotas: Vec<Quota>,
    pub members: Vec<Member>,
    pub limits: Vec<ProfileLimit>,
    pub script: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct PrincipalOptions {
    pub tablespaces: Vec<String>,
    pub temporary_tablespaces: Vec<String>,
    pub system_privileges: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrantableObject {
    pub name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct PrincipalChange {
    pub kind: String,
    pub name: String,
    pub action: String,
    pub cascade: bool,
    pub password: Option<String>,
    pub default_tablespace: Option<String>,
    pub temporary_tablespace: Option<String>,
    pub profile: Option<String>,
    pub locked: Option<bool>,
    pub expire_password: bool,
    pub grant_roles: Vec<RoleGrant>,
    pub revoke_roles: Vec<String>,
    pub default_roles: Option<Vec<String>>,
    pub default_roles_all: bool,
    pub grant_system_privileges: Vec<SystemGrant>,
    pub revoke_system_privileges: Vec<String>,
    pub grant_object_privileges: Vec<ObjectGrant>,
    pub revoke_object_privileges: Vec<ObjectGrant>,
    pub quotas: Vec<Quota>,
    pub grant_members: Vec<Member>,
    pub revoke_members: Vec<String>,
    pub limits: Vec<ProfileLimit>,
}

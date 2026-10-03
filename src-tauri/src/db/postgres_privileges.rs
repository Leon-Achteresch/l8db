pub(super) const SCHEMA_PRIVILEGES_SQL: &str = "SELECT n.nspname, \
        COALESCE('USAGE' = ANY(p.privs), false) AS usage_priv, \
        COALESCE('CREATE' = ANY(p.privs), false) AS create_priv \
     FROM pg_namespace n \
     LEFT JOIN LATERAL (SELECT array_agg(a.privilege_type) AS privs \
         FROM aclexplode(COALESCE(n.nspacl, acldefault('n'::\"char\", n.nspowner))) a \
         WHERE a.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = $1)) p ON true \
     WHERE n.nspname NOT LIKE 'pg_%' \
       AND n.nspname <> 'information_schema' \
     ORDER BY n.nspname";

pub(super) const TABLE_PRIVILEGES_SQL: &str =
    "SELECT c.relnamespace::regnamespace::text AS schema_name, \
        c.relname, \
        CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                       WHEN 'm' THEN 'materialized_view' WHEN 'S' THEN 'sequence' \
                       ELSE 'other' END AS object_type, \
        COALESCE('SELECT' = ANY(p.privs), false) AS sel, \
        COALESCE('INSERT' = ANY(p.privs), false) AS ins, \
        COALESCE('UPDATE' = ANY(p.privs), false) AS upd, \
        COALESCE('DELETE' = ANY(p.privs), false) AS del, \
        COALESCE('TRUNCATE' = ANY(p.privs), false) AS trunc, \
        COALESCE('REFERENCES' = ANY(p.privs), false) AS refs, \
        COALESCE('TRIGGER' = ANY(p.privs), false) AS trig \
     FROM pg_class c \
     JOIN pg_namespace n ON n.oid = c.relnamespace \
     LEFT JOIN LATERAL (SELECT array_agg(a.privilege_type) AS privs \
         FROM aclexplode(COALESCE(c.relacl, acldefault( \
             CASE WHEN c.relkind = 'S' THEN 's'::\"char\" ELSE 'r'::\"char\" END, c.relowner))) a \
         WHERE a.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = $1)) p ON true \
     WHERE c.relkind IN ('r', 'v', 'm', 'S') \
       AND n.nspname NOT LIKE 'pg_%' \
       AND n.nspname <> 'information_schema' \
     ORDER BY n.nspname, c.relname";

#[cfg(test)]
mod tests {
    use crate::db::pool::create_pool_state;
    use crate::db::{DatabaseAdapter, RolePrivileges};

    fn lab_adapter() -> super::super::PostgresAdapter {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgresql://postgres:testpw@127.0.0.1:5433/testdb".to_string());
        super::super::PostgresAdapter::from_connection_string(&url, None, create_pool_state())
            .expect("adapter")
    }

    fn schema(p: &RolePrivileges) -> (bool, bool) {
        p.schemas
            .iter()
            .find(|s| s.schema == "l8db_privgrid")
            .map(|s| (s.usage, s.create))
            .unwrap()
    }

    fn table(p: &RolePrivileges, name: &str) -> [bool; 7] {
        p.tables
            .iter()
            .find(|t| t.schema == "l8db_privgrid" && t.table == name)
            .map(|t| {
                [
                    t.select,
                    t.insert,
                    t.update,
                    t.delete,
                    t.truncate,
                    t.references,
                    t.trigger,
                ]
            })
            .unwrap()
    }

    #[tokio::test]
    #[ignore]
    async fn role_privileges_list_only_direct_grants() {
        let adapter = lab_adapter();
        let cleanup = "DROP SCHEMA IF EXISTS l8db_privgrid CASCADE; \
             DROP ROLE IF EXISTS l8db_priv_alice; DROP ROLE IF EXISTS l8db_priv_grp; \
             DROP ROLE IF EXISTS l8db_priv_su";
        adapter.execute_query(cleanup).await.unwrap();
        adapter
            .execute_query(
                "CREATE ROLE l8db_priv_grp; CREATE ROLE l8db_priv_alice IN ROLE l8db_priv_grp; \
                 CREATE ROLE l8db_priv_su SUPERUSER; CREATE SCHEMA l8db_privgrid; \
                 CREATE TABLE l8db_privgrid.t1(id int); CREATE SEQUENCE l8db_privgrid.s1; \
                 GRANT USAGE ON SCHEMA l8db_privgrid TO l8db_priv_grp; \
                 GRANT CREATE ON SCHEMA l8db_privgrid TO l8db_priv_alice; \
                 GRANT SELECT ON l8db_privgrid.t1 TO PUBLIC; \
                 GRANT INSERT ON l8db_privgrid.t1 TO l8db_priv_grp; \
                 GRANT UPDATE ON l8db_privgrid.t1 TO l8db_priv_alice; \
                 GRANT SELECT ON l8db_privgrid.s1 TO l8db_priv_alice",
            )
            .await
            .unwrap();
        let alice = adapter.list_role_privileges("l8db_priv_alice").await;
        let su = adapter.list_role_privileges("l8db_priv_su").await;
        let owner = adapter.list_role_privileges("postgres").await;
        adapter.execute_query(cleanup).await.unwrap();
        let (alice, su, owner) = (alice.unwrap(), su.unwrap(), owner.unwrap());

        assert_eq!(schema(&alice), (false, true));
        assert_eq!(
            table(&alice, "t1"),
            [false, false, true, false, false, false, false]
        );
        assert_eq!(
            table(&alice, "s1"),
            [true, false, false, false, false, false, false]
        );
        assert_eq!(schema(&su), (false, false));
        assert_eq!(table(&su, "t1"), [false; 7]);
        assert_eq!(schema(&owner), (true, true));
        assert_eq!(table(&owner, "t1"), [true; 7]);
        assert_eq!(
            table(&owner, "s1"),
            [true, false, true, false, false, false, false]
        );
    }
}

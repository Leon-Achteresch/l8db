\set ON_ERROR_STOP on

SELECT :'control_schema' NOT IN ('public', 'pg_catalog', 'information_schema')
  AND :'control_owner' <> :'deployer' AND :'control_owner' <> :'reviewer'
  AND :'deployer' <> :'reviewer' AND :'administrator' <> :'deployer'
  AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=:'control_schema' AND c.relname NOT IN ('L8DB_VERSIONING_LOCKS','L8DB_VERSIONING_POLICY','L8DB_VERSIONING_JOURNAL','L8DB_VERSIONING_APPROVALS','L8DB_VERSIONING_STATE','L8DB_VERSIONING_CHANGES','L8DB_VERSIONING_OBJECTS'))
  AS safe_control_schema \gset
\if :safe_control_schema
\else
  \quit 1
\endif

BEGIN;

CREATE SCHEMA IF NOT EXISTS :"control_schema" AUTHORIZATION :"control_owner";
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_LOCKS" ("LOCK_ID" VARCHAR(100) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_POLICY" ("PROJECT_ID" VARCHAR(100) PRIMARY KEY, "REVISION" INTEGER NOT NULL, "BODY" TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_JOURNAL" ("ENTRY_ID" VARCHAR(100) PRIMARY KEY, "PROJECT_ID" VARCHAR(100) NOT NULL, "RUN_ID" VARCHAR(100) NOT NULL, "CREATED_AT" TIMESTAMP NOT NULL, "ACTOR" VARCHAR(256) NOT NULL, "EVENT" VARCHAR(100) NOT NULL, "BODY" TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_APPROVALS" ("PROJECT_ID" VARCHAR(100) NOT NULL, "ARTIFACT" VARCHAR(64) NOT NULL, "ACTOR" VARCHAR(256) NOT NULL, "CREATED_AT" TIMESTAMP NOT NULL, PRIMARY KEY ("PROJECT_ID", "ARTIFACT", "ACTOR", "CREATED_AT"));
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_STATE" ("PROJECT_ID" VARCHAR(100) PRIMARY KEY, "RELEASE_ID" VARCHAR(100) NOT NULL, "RELEASE_HASH" VARCHAR(64) NOT NULL, "LEASE" VARCHAR(64), "STATUS" VARCHAR(20) NOT NULL);
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_CHANGES" ("PROJECT_ID" VARCHAR(100) NOT NULL, "CHANGE_ID" VARCHAR(255) NOT NULL, "CHECKSUM" VARCHAR(64) NOT NULL, "KIND" VARCHAR(20) NOT NULL, "SOURCE" VARCHAR(20) NOT NULL, "RELEASE_ID" VARCHAR(100), "RUN_ID" VARCHAR(100), "APPLIED_AT" TIMESTAMP NOT NULL, "APPLIED_BY" VARCHAR(256) NOT NULL, PRIMARY KEY ("PROJECT_ID", "CHANGE_ID"));
CREATE TABLE IF NOT EXISTS :"control_schema"."L8DB_VERSIONING_OBJECTS" ("PROJECT_ID" VARCHAR(100) NOT NULL, "OBJECT_ID" VARCHAR(100) NOT NULL, "APPLIED_HASH" VARCHAR(64) NOT NULL, "CHANGE_ID" VARCHAR(255), "APPLIED_AT" TIMESTAMP NOT NULL, PRIMARY KEY ("PROJECT_ID", "OBJECT_ID"));

CREATE OR REPLACE FUNCTION :"control_schema".l8db_authentic_actor() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE rules jsonb;
BEGIN
  EXECUTE format('SELECT "BODY"::jsonb FROM %I."L8DB_VERSIONING_POLICY" WHERE "PROJECT_ID"=$1', TG_TABLE_SCHEMA) INTO rules USING NEW."PROJECT_ID";
  IF TG_TABLE_NAME = 'L8DB_VERSIONING_APPROVALS' THEN
    IF NOT COALESCE((rules->'reviewers') ? session_user::text, false) THEN RAISE EXCEPTION 'Reviewer is not authorized'; END IF;
  ELSE
    IF NOT (COALESCE((rules->'operators') ? session_user::text, false) OR COALESCE((rules->'administrators') ? session_user::text, false) OR (NEW."EVENT" = 'approved' AND COALESCE((rules->'reviewers') ? session_user::text, false))) THEN RAISE EXCEPTION 'Operator is not authorized'; END IF;
  END IF;
  NEW."ACTOR" := session_user;
  NEW."CREATED_AT" := clock_timestamp() AT TIME ZONE 'UTC';
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION :"control_schema".l8db_immutable_lock() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Lock records cannot be modified';
END;
$$;

DROP TRIGGER IF EXISTS l8db_authentic_actor ON :"control_schema"."L8DB_VERSIONING_JOURNAL";
CREATE TRIGGER l8db_authentic_actor BEFORE INSERT ON :"control_schema"."L8DB_VERSIONING_JOURNAL" FOR EACH ROW EXECUTE FUNCTION :"control_schema".l8db_authentic_actor();
ALTER TABLE :"control_schema"."L8DB_VERSIONING_JOURNAL" ENABLE ALWAYS TRIGGER l8db_authentic_actor;
DROP TRIGGER IF EXISTS l8db_authentic_actor ON :"control_schema"."L8DB_VERSIONING_APPROVALS";
CREATE TRIGGER l8db_authentic_actor BEFORE INSERT ON :"control_schema"."L8DB_VERSIONING_APPROVALS" FOR EACH ROW EXECUTE FUNCTION :"control_schema".l8db_authentic_actor();
ALTER TABLE :"control_schema"."L8DB_VERSIONING_APPROVALS" ENABLE ALWAYS TRIGGER l8db_authentic_actor;
DROP TRIGGER IF EXISTS l8db_immutable_lock ON :"control_schema"."L8DB_VERSIONING_LOCKS";
CREATE TRIGGER l8db_immutable_lock BEFORE UPDATE ON :"control_schema"."L8DB_VERSIONING_LOCKS" FOR EACH ROW EXECUTE FUNCTION :"control_schema".l8db_immutable_lock();
ALTER TABLE :"control_schema"."L8DB_VERSIONING_LOCKS" ENABLE ALWAYS TRIGGER l8db_immutable_lock;

ALTER TABLE :"control_schema"."L8DB_VERSIONING_LOCKS" OWNER TO :"control_owner";
ALTER TABLE :"control_schema"."L8DB_VERSIONING_POLICY" OWNER TO :"control_owner";
ALTER TABLE :"control_schema"."L8DB_VERSIONING_JOURNAL" OWNER TO :"control_owner";
ALTER TABLE :"control_schema"."L8DB_VERSIONING_APPROVALS" OWNER TO :"control_owner";
ALTER TABLE :"control_schema"."L8DB_VERSIONING_STATE" OWNER TO :"control_owner";
ALTER TABLE :"control_schema"."L8DB_VERSIONING_CHANGES" OWNER TO :"control_owner";
ALTER TABLE :"control_schema"."L8DB_VERSIONING_OBJECTS" OWNER TO :"control_owner";
ALTER FUNCTION :"control_schema".l8db_authentic_actor() OWNER TO :"control_owner";
ALTER FUNCTION :"control_schema".l8db_immutable_lock() OWNER TO :"control_owner";

REVOKE ALL ON SCHEMA :"control_schema" FROM PUBLIC, :"deployer", :"reviewer";
REVOKE ALL ON ALL TABLES IN SCHEMA :"control_schema" FROM PUBLIC, :"deployer", :"reviewer";
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA :"control_schema" FROM PUBLIC;
GRANT USAGE ON SCHEMA :"control_schema" TO :"deployer", :"reviewer", :"administrator";
GRANT SELECT ON ALL TABLES IN SCHEMA :"control_schema" TO :"deployer", :"reviewer", :"administrator";
GRANT INSERT ON :"control_schema"."L8DB_VERSIONING_JOURNAL" TO :"deployer", :"reviewer", :"administrator";
GRANT INSERT ON :"control_schema"."L8DB_VERSIONING_APPROVALS" TO :"reviewer";
GRANT UPDATE ON :"control_schema"."L8DB_VERSIONING_STATE" TO :"deployer", :"administrator";
GRANT UPDATE ("LOCK_ID") ON :"control_schema"."L8DB_VERSIONING_LOCKS" TO :"deployer", :"administrator";
GRANT INSERT ON :"control_schema"."L8DB_VERSIONING_CHANGES" TO :"deployer", :"administrator";
GRANT INSERT, UPDATE ON :"control_schema"."L8DB_VERSIONING_OBJECTS" TO :"deployer", :"administrator";
GRANT INSERT, UPDATE ON :"control_schema"."L8DB_VERSIONING_POLICY" TO :"administrator";
GRANT INSERT ON :"control_schema"."L8DB_VERSIONING_LOCKS", :"control_schema"."L8DB_VERSIONING_STATE" TO :"administrator";
COMMIT;

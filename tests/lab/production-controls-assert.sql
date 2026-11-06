\set ON_ERROR_STOP on
SET SESSION AUTHORIZATION l8db_administrator;
INSERT INTO l8db_control."L8DB_VERSIONING_POLICY" VALUES ('test',1,'{"operators":["l8db_deployer"],"reviewers":["l8db_reviewer"],"administrators":["l8db_administrator"]}');
INSERT INTO l8db_control."L8DB_VERSIONING_LOCKS" VALUES ('test');
INSERT INTO l8db_control."L8DB_VERSIONING_STATE" VALUES ('test','r1','hash',NULL,'ready');

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION l8db_deployer;
INSERT INTO l8db_control."L8DB_VERSIONING_JOURNAL" VALUES ('entry','test','run','2099-01-01','forged-reviewer','started','{}');
BEGIN;
SELECT * FROM l8db_control."L8DB_VERSIONING_LOCKS" FOR UPDATE;
UPDATE l8db_control."L8DB_VERSIONING_STATE" SET "STATUS"='running' WHERE "PROJECT_ID"='test';
COMMIT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM l8db_control."L8DB_VERSIONING_JOURNAL" WHERE "ACTOR"=session_user AND "CREATED_AT" BETWEEN (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 minute' AND (clock_timestamp() AT TIME ZONE 'UTC')) THEN RAISE EXCEPTION 'Actor or timestamp was not authenticated'; END IF;
  BEGIN
    DELETE FROM l8db_control."L8DB_VERSIONING_JOURNAL";
    RAISE EXCEPTION 'Deployer deleted audit records';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE l8db_control."L8DB_VERSIONING_POLICY" SET "BODY"='{}';
    RAISE EXCEPTION 'Deployer changed policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO l8db_control."L8DB_VERSIONING_APPROVALS" VALUES ('test','hash','l8db_reviewer',NOW());
    RAISE EXCEPTION 'Deployer approved own release';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

RESET SESSION AUTHORIZATION;
SET SESSION AUTHORIZATION l8db_reviewer;
INSERT INTO l8db_control."L8DB_VERSIONING_APPROVALS" VALUES ('test','hash','forged-actor','2099-01-01');
INSERT INTO l8db_control."L8DB_VERSIONING_JOURNAL" VALUES ('review','test','run','2099-01-01','forged-actor','approved','{}');
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM l8db_control."L8DB_VERSIONING_APPROVALS" WHERE "ACTOR"=session_user AND "CREATED_AT" < TIMESTAMP '2099-01-01') THEN RAISE EXCEPTION 'Approval identity was not authenticated'; END IF;
  BEGIN
    INSERT INTO l8db_control."L8DB_VERSIONING_JOURNAL" VALUES ('forged-run','test','run',NOW(),session_user,'succeeded','{}');
    RAISE EXCEPTION USING ERRCODE='XX001', MESSAGE='Reviewer forged a deployment result';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
END;
$$;
RESET SESSION AUTHORIZATION;
SELECT 'Production controls: separate roles, immutable journal, authentic actors, authentic timestamps, self-approval denied' AS result;

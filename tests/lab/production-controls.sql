\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS l8db_control CASCADE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='l8db_control_owner') THEN CREATE ROLE l8db_control_owner NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='l8db_deployer') THEN CREATE ROLE l8db_deployer LOGIN PASSWORD 'lab-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='l8db_reviewer') THEN CREATE ROLE l8db_reviewer LOGIN PASSWORD 'lab-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='l8db_administrator') THEN CREATE ROLE l8db_administrator LOGIN PASSWORD 'lab-only'; END IF;
END;
$$;

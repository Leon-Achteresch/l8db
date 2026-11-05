BEGIN;
CREATE SCHEMA IF NOT EXISTS l8db_billing;
REVOKE ALL ON SCHEMA l8db_billing FROM PUBLIC, anon, authenticated;
CREATE TABLE IF NOT EXISTS l8db_billing.events (
    id text PRIMARY KEY CHECK (id ~ '^evt_[A-Za-z0-9]+$'),
    stripe_account text NOT NULL,
    type text NOT NULL,
    livemode boolean NOT NULL,
    created bigint NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS l8db_billing.objects (
    id text PRIMARY KEY,
    stripe_account text NOT NULL,
    type text NOT NULL,
    event_id text NOT NULL,
    event_created bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    payload jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS l8db_billing.customers (
    stripe_account text NOT NULL,
    user_id uuid NOT NULL,
    customer_id text NOT NULL CHECK (customer_id ~ '^cus_[A-Za-z0-9]+$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (stripe_account, user_id),
    UNIQUE (stripe_account, customer_id)
);
CREATE INDEX IF NOT EXISTS objects_type_idx ON l8db_billing.objects (stripe_account, type);
ALTER TABLE l8db_billing.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE l8db_billing.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE l8db_billing.customers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA l8db_billing FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.l8db_billing_apply_event(event jsonb, account text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $billing$
DECLARE
    inserted integer;
    target jsonb := event->'data'->'object';
BEGIN
    IF jsonb_typeof(event) IS DISTINCT FROM 'object'
       OR coalesce(event->>'id', '') !~ '^evt_[A-Za-z0-9]+$'
       OR jsonb_typeof(event->'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(event->'created') IS DISTINCT FROM 'number'
       OR jsonb_typeof(event->'livemode') IS DISTINCT FROM 'boolean'
       OR jsonb_typeof(target) IS DISTINCT FROM 'object'
       OR jsonb_typeof(target->'id') IS DISTINCT FROM 'string'
       OR coalesce(account, '') !~ '^acct_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'invalid billing event';
    END IF;
    INSERT INTO l8db_billing.events(id, stripe_account, type, livemode, created, payload)
    VALUES (event->>'id', account, event->>'type', (event->>'livemode')::boolean,
        (event->>'created')::bigint, event)
    ON CONFLICT (id) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted = 0 THEN
        RETURN false;
    END IF;
    INSERT INTO l8db_billing.objects(id, stripe_account, type, event_id, event_created, payload)
    VALUES (target->>'id', account, coalesce(target->>'object', ''), event->>'id',
        (event->>'created')::bigint, target)
    ON CONFLICT (id) DO UPDATE SET
        event_id = EXCLUDED.event_id,
        event_created = EXCLUDED.event_created,
        updated_at = now(),
        payload = EXCLUDED.payload
    WHERE l8db_billing.objects.event_created <= EXCLUDED.event_created;
    RETURN true;
END;
$billing$;
REVOKE ALL ON FUNCTION public.l8db_billing_apply_event(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.l8db_billing_apply_event(jsonb, text) TO service_role;
CREATE OR REPLACE FUNCTION public.l8db_billing_customer(account text, actor uuid, stripe_customer text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $billing$
DECLARE
    found text;
BEGIN
    IF actor IS NULL OR coalesce(account, '') !~ '^acct_[A-Za-z0-9]+$' THEN
        RAISE EXCEPTION 'missing billing actor';
    END IF;
    IF stripe_customer IS NOT NULL THEN
        IF stripe_customer !~ '^cus_[A-Za-z0-9]+$' THEN
            RAISE EXCEPTION 'invalid billing customer';
        END IF;
        INSERT INTO l8db_billing.customers(stripe_account, user_id, customer_id)
        VALUES (account, actor, stripe_customer)
        ON CONFLICT (stripe_account, user_id) DO NOTHING;
    END IF;
    SELECT c.customer_id INTO found FROM l8db_billing.customers c
    WHERE c.stripe_account = account AND c.user_id = actor;
    RETURN found;
END;
$billing$;
REVOKE ALL ON FUNCTION public.l8db_billing_customer(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.l8db_billing_customer(text, uuid, text) TO service_role;
COMMIT;
